package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tyemirov/tauth/pkg/sessionvalidator"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type runOptions struct {
	loggerFactory   func() (*zap.Logger, error)
	grpcDialFunc    func(target string, opts ...grpc.DialOption) (*grpc.ClientConn, error)
	shutdownTimeout time.Duration
	onServerReady   func(srv *http.Server)
	store           Store
}

// RunOption configures optional behaviour of Run.
type RunOption func(*runOptions)

// WithLoggerFactory overrides the default logger construction.
func WithLoggerFactory(f func() (*zap.Logger, error)) RunOption {
	return func(o *runOptions) { o.loggerFactory = f }
}

// WithGRPCDialFunc overrides the default gRPC dial function.
func WithGRPCDialFunc(f func(target string, opts ...grpc.DialOption) (*grpc.ClientConn, error)) RunOption {
	return func(o *runOptions) { o.grpcDialFunc = f }
}

// WithShutdownTimeout overrides the graceful shutdown duration.
func WithShutdownTimeout(d time.Duration) RunOption {
	return func(o *runOptions) { o.shutdownTimeout = d }
}

// WithStore injects a pre-configured store implementation.
func WithStore(s Store) RunOption {
	return func(o *runOptions) { o.store = s }
}

// Run boots the HTTP service using the supplied configuration.
func Run(ctx context.Context, cfg Config, opts ...RunOption) error {
	o := runOptions{
		loggerFactory:   func() (*zap.Logger, error) { return zap.NewProduction() },
		grpcDialFunc:    grpc.NewClient,
		shutdownTimeout: 5 * time.Second,
	}
	for _, opt := range opts {
		opt(&o)
	}

	logger, err := o.loggerFactory()
	if err != nil {
		return fmt.Errorf("zap init: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	dialOptions := []grpc.DialOption{}
	if cfg.LedgerInsecure {
		dialOptions = append(dialOptions, grpc.WithTransportCredentials(insecure.NewCredentials()))
	} else {
		dialOptions = append(dialOptions, grpc.WithTransportCredentials(credentials.NewClientTLSFromCert(nil, "")))
	}
	conn, err := o.grpcDialFunc(cfg.LedgerAddress, dialOptions...)
	if err != nil {
		return fmt.Errorf("connect ledger: %w", err)
	}
	conn.Connect()
	if err := waitForClientReady(ctx, conn); err != nil {
		_ = conn.Close()
		return fmt.Errorf("connect ledger: %w", err)
	}
	defer conn.Close()

	ledgerClient := creditv1.NewCreditServiceClient(conn)
	sessionValidator, err := sessionvalidator.New(sessionvalidator.Config{
		SigningKey: []byte(cfg.SessionSigningKey),
		Issuer:     cfg.SessionIssuer,
		CookieName: cfg.SessionCookieName,
	})
	if err != nil {
		return fmt.Errorf("session validator: %w", err)
	}

	store := o.store
	if store == nil {
		var storeErr error
		store, storeErr = OpenDatabase(cfg.DatabaseDSN)
		if storeErr != nil {
			return fmt.Errorf("open database: %w", storeErr)
		}
	}

	handler := &httpHandler{
		logger:        logger,
		ledgerClient:  ledgerClient,
		cfg:           cfg,
		llmHTTPClient: &http.Client{Timeout: cfg.LLMProxyTimeout},
		store:         store,
	}
	billingService, billingErr := newBillingService(cfg, ledgerClient, store, logger)
	if billingErr != nil {
		return fmt.Errorf("billing init: %w", billingErr)
	}
	handler.billingService = billingService

	router := setupRouter(cfg, handler, sessionValidator)

	server := &http.Server{
		Addr:    cfg.ListenAddr,
		Handler: router,
	}

	if o.onServerReady != nil {
		o.onServerReady(server)
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("crossword-api listening", zap.String("addr", cfg.ListenAddr))
		errCh <- server.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), o.shutdownTimeout)
		defer cancel()
		if shutdownErr := server.Shutdown(shutdownCtx); shutdownErr != nil {
			logger.Warn("server shutdown error", zap.Error(shutdownErr))
		}
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

func setupRouter(cfg Config, handler *httpHandler, validator *sessionvalidator.Validator) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	router.Use(cors.New(cors.Config{
		AllowOrigins:     cfg.AllowedOrigins,
		AllowMethods:     []string{"GET", "POST", "OPTIONS"},
		AllowHeaders:     []string{"Content-Type", "Origin", "Accept"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	router.GET("/healthz", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	// Public endpoint — no auth required.
	router.GET("/api/shared/:token", handler.handleGetSharedPuzzle)
	// Shared completion accepts anonymous requests but upgrades to the
	// authenticated flow when a valid session cookie is present.
	router.POST("/api/shared/:token/complete", optionalSessionMiddleware(validator, "auth_claims"), handler.handleCompleteSharedPuzzle)
	router.POST("/api/billing/paddle/webhook", handler.handleBillingWebhook)

	api := router.Group("/api")
	api.Use(validator.GinMiddleware("auth_claims"))

	api.GET("/session", handler.handleSession)
	api.POST("/bootstrap", handler.handleBootstrap)
	api.GET("/balance", handler.handleBalance)
	api.GET("/billing/summary", handler.handleBillingSummary)
	api.POST("/billing/checkout", handler.handleBillingCheckout)
	api.POST("/billing/portal", handler.handleBillingPortal)
	api.POST("/generate", handler.handleGenerate)
	api.GET("/puzzles", handler.handleListPuzzles)
	api.GET("/puzzles/:id", handler.handleGetPuzzle)
	api.POST("/puzzles/:id/complete", handler.handleCompletePuzzle)
	api.DELETE("/puzzles/:id", handler.handleDeletePuzzle)

	admin := api.Group("/admin")
	admin.Use(handler.requireAdmin)
	admin.GET("/users", handler.handleAdminListUsers)
	admin.GET("/balance", handler.handleAdminBalance)
	admin.GET("/grants", handler.handleAdminGrantHistory)
	admin.POST("/grant", handler.handleAdminGrant)

	return router
}

func optionalSessionMiddleware(validator *sessionvalidator.Validator, contextKey string) gin.HandlerFunc {
	if strings.TrimSpace(contextKey) == "" {
		contextKey = sessionvalidator.DefaultContextKey
	}
	return func(ctx *gin.Context) {
		if validator != nil {
			claims, err := validator.ValidateRequest(ctx.Request)
			if err == nil {
				ctx.Set(contextKey, claims)
			}
		}
		ctx.Next()
	}
}

type httpHandler struct {
	logger         *zap.Logger
	ledgerClient   creditv1.CreditServiceClient
	cfg            Config
	llmHTTPClient  *http.Client
	store          Store
	billingService *billingService
}

const (
	adminGrantHistoryLimit = 20
	adminGrantReasonMaxLen = 240
)

func (handler *httpHandler) handleSession(ctx *gin.Context) {
	claims := getClaims(ctx)
	var roles []string
	isAdmin := false
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	handler.syncUserProfile(claims)
	roles = append(roles, claims.GetUserRoles()...)
	isAdmin = handler.cfg.IsAdmin(claims.GetUserEmail()) || hasRole(claims, "admin")
	if isAdmin && !hasRole(claims, "admin") {
		roles = append(roles, "admin")
	}
	ctx.JSON(http.StatusOK, gin.H{
		"user_id":    claims.GetUserID(),
		"email":      claims.GetUserEmail(),
		"display":    claims.GetUserDisplayName(),
		"avatar_url": claims.GetUserAvatarURL(),
		"roles":      roles,
		"expires":    claims.GetExpiresAt().Unix(),
		"is_admin":   isAdmin,
	})
}

func (handler *httpHandler) handleBootstrap(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	handler.syncUserProfile(claims)
	requestCtx, cancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LedgerTimeout)
	defer cancel()

	grants, err := handler.ensureBootstrapAndDailyGrants(requestCtx, claims.GetUserID())
	if err != nil {
		handler.logger.Error("bootstrap grant failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "grant failed"))
		return
	}
	balance, balanceErr := handler.fetchBalance(ctx.Request.Context(), claims.GetUserID())
	if balanceErr != nil {
		handler.logger.Error("balance fetch failed", zap.Error(balanceErr))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "balance unavailable"))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"balance": balance, "grants": grants})
}

func (handler *httpHandler) handleBalance(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	handler.respondWithBalance(ctx, claims.GetUserID())
}

func (handler *httpHandler) handleBillingSummary(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}

	summary, err := handler.billingService.Summary(ctx.Request.Context(), claims.GetUserID())
	if err != nil {
		handler.logger.Error("billing summary failed", zap.Error(err), zap.String("user_id", claims.GetUserID()))
		ctx.JSON(http.StatusInternalServerError, errorResponse("billing_error", "billing summary unavailable"))
		return
	}

	balance, balanceErr := handler.fetchBalance(ctx.Request.Context(), claims.GetUserID())
	if balanceErr != nil {
		handler.logger.Error("billing summary balance failed", zap.Error(balanceErr), zap.String("user_id", claims.GetUserID()))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "balance unavailable"))
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"enabled":          summary.Enabled,
		"provider_code":    summary.ProviderCode,
		"balance":          balance,
		"packs":            summary.Packs,
		"activity":         summary.Activity,
		"portal_available": summary.PortalAvailable,
	})
}

func (handler *httpHandler) handleBillingCheckout(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	if handler.billingService == nil {
		ctx.JSON(http.StatusServiceUnavailable, errorResponse("billing_unavailable", "billing is not enabled"))
		return
	}

	var req billingCheckoutRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "expected JSON body with pack_id"))
		return
	}

	returnURL := buildAbsoluteRequestURL(ctx.Request, "/?billing_transaction_id={transaction_id}")
	checkoutSession, err := handler.billingService.CreateCheckout(
		ctx.Request.Context(),
		claims.GetUserID(),
		claims.GetUserEmail(),
		req.PackID,
		returnURL,
	)
	if err != nil {
		switch {
		case errors.Is(err, ErrBillingPackUnknown):
			ctx.JSON(http.StatusBadRequest, errorResponse("invalid_pack", "billing pack not found"))
		case errors.Is(err, ErrBillingDisabled):
			ctx.JSON(http.StatusServiceUnavailable, errorResponse("billing_unavailable", "billing is not enabled"))
		case errors.Is(err, ErrPaddleCheckoutURLMissing):
			ctx.JSON(http.StatusBadGateway, errorResponse("billing_checkout_missing", "configure Paddle default payment link before checkout"))
		default:
			handler.logger.Error("billing checkout failed", zap.Error(err), zap.String("user_id", claims.GetUserID()))
			ctx.JSON(http.StatusBadGateway, errorResponse("billing_checkout_failed", "unable to start checkout"))
		}
		return
	}

	ctx.JSON(http.StatusOK, checkoutSession)
}

func (handler *httpHandler) handleBillingPortal(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	if handler.billingService == nil {
		ctx.JSON(http.StatusServiceUnavailable, errorResponse("billing_unavailable", "billing is not enabled"))
		return
	}

	portalSession, err := handler.billingService.CreatePortalSession(ctx.Request.Context(), claims.GetUserID())
	if err != nil {
		switch {
		case errors.Is(err, ErrBillingPortalUnavailable):
			ctx.JSON(http.StatusBadRequest, errorResponse("billing_portal_unavailable", "billing portal is unavailable"))
		case errors.Is(err, ErrBillingDisabled):
			ctx.JSON(http.StatusServiceUnavailable, errorResponse("billing_unavailable", "billing is not enabled"))
		default:
			handler.logger.Error("billing portal failed", zap.Error(err), zap.String("user_id", claims.GetUserID()))
			ctx.JSON(http.StatusBadGateway, errorResponse("billing_portal_failed", "unable to open billing portal"))
		}
		return
	}
	ctx.JSON(http.StatusOK, portalSession)
}

func (handler *httpHandler) handleBillingWebhook(ctx *gin.Context) {
	if handler.billingService == nil {
		ctx.JSON(http.StatusServiceUnavailable, errorResponse("billing_unavailable", "billing is not enabled"))
		return
	}

	payload, err := io.ReadAll(http.MaxBytesReader(ctx.Writer, ctx.Request.Body, 1024*1024))
	if err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "unable to read webhook payload"))
		return
	}

	signatureHeader := strings.TrimSpace(ctx.Request.Header.Get(handler.billingService.provider.SignatureHeaderName()))
	if signatureHeader == "" {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing webhook signature"))
		return
	}

	if err := handler.billingService.HandleWebhook(ctx.Request.Context(), signatureHeader, payload); err != nil {
		switch {
		case errors.Is(err, ErrBillingUnauthorized):
			ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "invalid webhook signature"))
		case errors.Is(err, ErrBillingWebhookInvalid):
			ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "invalid webhook payload"))
		default:
			handler.logger.Error("billing webhook failed", zap.Error(err))
			ctx.JSON(http.StatusInternalServerError, errorResponse("billing_webhook_failed", "billing webhook processing failed"))
		}
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"ok": true})
}

type generateRequest struct {
	Topic     string `json:"topic"`
	WordCount int    `json:"word_count"`
}

func (handler *httpHandler) handleGenerate(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	handler.syncUserProfile(claims)

	var req generateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "expected JSON body with topic"))
		return
	}

	topic := sanitizeTopic(req.Topic)
	if topic == "" {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_topic", "topic is required"))
		return
	}
	if len(topic) > 200 {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_topic", "topic must be 200 characters or fewer"))
		return
	}

	wordCount := req.WordCount
	if wordCount < 5 {
		wordCount = 8
	}
	if wordCount > 15 {
		wordCount = 15
	}

	// Debit credits via Ledger.
	spendCtx, spendCancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LedgerTimeout)
	defer spendCancel()

	_, err := handler.ledgerClient.Spend(spendCtx, &creditv1.SpendRequest{
		UserId:         claims.GetUserID(),
		AmountCents:    handler.cfg.GenerateAmountCents(),
		IdempotencyKey: fmt.Sprintf("generate:%s", uuid.NewString()),
		MetadataJson:   marshalMetadata(map[string]any{"action": "generate", "topic": topic}),
		LedgerId:       handler.cfg.DefaultLedgerID,
		TenantId:       handler.cfg.DefaultTenantID,
	})
	if err != nil {
		if isGRPCInsufficientFunds(err) {
			ctx.JSON(http.StatusPaymentRequired, errorResponse("insufficient_credits", "not enough credits to generate a puzzle"))
			return
		}
		handler.logger.Error("spend failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "spend failed"))
		return
	}

	// Call LLM proxy.
	llmCtx, llmCancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LLMProxyTimeout)
	defer llmCancel()

	items, llmErr := handler.callLLMProxy(llmCtx, topic, wordCount)
	if llmErr != nil {
		handler.logger.Error("llm proxy call failed", zap.Error(llmErr), zap.String("topic", topic))

		// Refund the debited credits since generation failed.
		handler.refundCredits(ctx.Request.Context(), claims.GetUserID(), handler.cfg.GenerateAmountCents(), "generate_failure")

		// Return a specific HTTP status and error code based on the upstream failure.
		var proxyErr *llmProxyError
		if errors.As(llmErr, &proxyErr) && proxyErr.StatusCode == http.StatusGatewayTimeout {
			ctx.JSON(http.StatusGatewayTimeout, errorResponse("llm_timeout", "the language model took too long — credits have been refunded, please try again"))
			return
		}
		ctx.JSON(http.StatusBadGateway, errorResponse("llm_error", "failed to generate words — credits have been refunded, please try again"))
		return
	}

	metadata, metadataErr := handler.generatePuzzleMetadata(ctx.Request.Context(), topic, items)
	if metadataErr != nil {
		handler.logger.Warn("puzzle metadata generation failed", zap.Error(metadataErr), zap.String("topic", topic))
		metadata = fallbackPuzzleMetadata(topic)
	}

	// Save puzzle to database.
	puzzle := &Puzzle{
		UserID:      claims.GetUserID(),
		Title:       metadata.Title,
		Subtitle:    metadata.Subtitle,
		Description: metadata.Description,
		Topic:       topic,
	}
	for _, item := range items {
		puzzle.Words = append(puzzle.Words, PuzzleWord{
			Word: item.Word,
			Clue: item.Definition,
			Hint: item.Hint,
		})
	}
	if err := handler.store.CreatePuzzle(puzzle); err != nil {
		handler.logger.Error("save puzzle failed", zap.Error(err))
		// Non-fatal: still return the puzzle to the user.
	}

	// Fetch updated balance.
	balanceCtx, balanceCancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LedgerTimeout)
	defer balanceCancel()
	balance, _ := handler.fetchBalance(balanceCtx, claims.GetUserID())
	if puzzle.ID != "" {
		if decorateErr := handler.decorateOwnedPuzzle(puzzle, claims.GetUserID(), time.Now().UTC()); decorateErr != nil {
			handler.logger.Error("decorate generated puzzle failed", zap.Error(decorateErr), zap.String("puzzle_id", puzzle.ID))
		}
	}

	ctx.JSON(http.StatusOK, gin.H{
		"items":          items,
		"title":          metadata.Title,
		"subtitle":       metadata.Subtitle,
		"description":    metadata.Description,
		"balance":        balance,
		"id":             puzzle.ID,
		"share_token":    puzzle.ShareToken,
		"source":         puzzle.Source,
		"reward_summary": puzzle.RewardSummary,
	})
}

func (handler *httpHandler) generatePuzzleMetadata(ctx context.Context, topic string, items []WordItem) (*PuzzleMetadata, error) {
	var lastErr error

	for attempt := 0; attempt < 2; attempt++ {
		metadataCtx, metadataCancel := context.WithTimeout(ctx, handler.cfg.LLMProxyTimeout)
		metadata, err := handler.callPuzzleMetadataLLMProxy(metadataCtx, topic, items)
		metadataCancel()
		if err == nil {
			return metadata, nil
		}
		lastErr = err
	}
	return nil, lastErr
}

func fallbackPuzzleMetadata(topic string) *PuzzleMetadata {
	return &PuzzleMetadata{
		Title:       normalizeMetadataTitle(topic, topic),
		Subtitle:    "",
		Description: "",
	}
}

func (handler *httpHandler) respondWithBalance(ctx *gin.Context, userID string) {
	balance, err := handler.fetchBalance(ctx.Request.Context(), userID)
	if err != nil {
		handler.logger.Error("balance fetch failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "balance unavailable"))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"balance": balance})
}

type balanceResponse struct {
	TotalCents          int64 `json:"total_cents"`
	AvailableCents      int64 `json:"available_cents"`
	Coins               int64 `json:"coins"`
	GenerationCostCoins int64 `json:"generation_cost_coins"`
}

type bootstrapGrantSummary struct {
	BootstrapCoins  int64 `json:"bootstrap_coins"`
	DailyLoginCoins int64 `json:"daily_login_coins"`
	LowBalanceCoins int64 `json:"low_balance_coins"`
}

type completionRequest struct {
	UsedHint   bool `json:"used_hint"`
	UsedReveal bool `json:"used_reveal"`
}

type completionRewardBreakdown struct {
	Base        int64 `json:"base"`
	NoHintBonus int64 `json:"no_hint_bonus"`
	DailyBonus  int64 `json:"daily_bonus"`
	Total       int64 `json:"total"`
}

type completionResponse struct {
	Mode            string                    `json:"mode"`
	Balance         *balanceResponse          `json:"balance,omitempty"`
	Reward          completionRewardBreakdown `json:"reward"`
	CreatorRewarded bool                      `json:"creator_rewarded"`
	CreatorCoins    int64                     `json:"creator_coins"`
	Reason          string                    `json:"reason,omitempty"`
	RewardSummary   *RewardSummary            `json:"reward_summary,omitempty"`
}

func (handler *httpHandler) fetchBalance(ctx context.Context, userID string) (*balanceResponse, error) {
	requestCtx, cancel := context.WithTimeout(ctx, handler.cfg.LedgerTimeout)
	defer cancel()
	resp, err := handler.ledgerClient.GetBalance(requestCtx, &creditv1.BalanceRequest{
		UserId:   userID,
		LedgerId: handler.cfg.DefaultLedgerID,
		TenantId: handler.cfg.DefaultTenantID,
	})
	if err != nil {
		return nil, err
	}
	return &balanceResponse{
		TotalCents:          resp.GetTotalCents(),
		AvailableCents:      resp.GetAvailableCents(),
		Coins:               resp.GetAvailableCents() / handler.cfg.CoinValueCents,
		GenerationCostCoins: handler.cfg.GenerateCoins,
	}, nil
}

func utcDayBounds(now time.Time) (time.Time, time.Time) {
	utcNow := now.UTC()
	dayStart := time.Date(utcNow.Year(), utcNow.Month(), utcNow.Day(), 0, 0, 0, 0, time.UTC)
	return dayStart, dayStart.Add(24 * time.Hour)
}

func clampNonNegative(value int64) int64 {
	if value < 0 {
		return 0
	}
	return value
}

func (handler *httpHandler) ensureGrant(ctx context.Context, userID string, amountCents int64, idempotencyKey string, metadata map[string]any) (bool, error) {
	if amountCents <= 0 {
		return false, nil
	}

	_, err := handler.ledgerClient.Grant(ctx, &creditv1.GrantRequest{
		UserId:           userID,
		AmountCents:      amountCents,
		IdempotencyKey:   idempotencyKey,
		MetadataJson:     marshalMetadata(metadata),
		ExpiresAtUnixUtc: 0,
		LedgerId:         handler.cfg.DefaultLedgerID,
		TenantId:         handler.cfg.DefaultTenantID,
	})
	if err != nil {
		if isGRPCAlreadyExists(err) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (handler *httpHandler) ensureBootstrapAndDailyGrants(ctx context.Context, userID string) (*bootstrapGrantSummary, error) {
	grantSummary := &bootstrapGrantSummary{}
	dayStart, _ := utcDayBounds(time.Now().UTC())
	dayKey := dayStart.Format("2006-01-02")

	if applied, err := handler.ensureGrant(
		ctx,
		userID,
		handler.cfg.BootstrapAmountCents(),
		fmt.Sprintf("bootstrap:%s", userID),
		map[string]any{"action": "bootstrap"},
	); err != nil {
		return nil, err
	} else if applied {
		grantSummary.BootstrapCoins = handler.cfg.BootstrapCoins
	}

	if applied, err := handler.ensureGrant(
		ctx,
		userID,
		handler.cfg.DailyLoginAmountCents(),
		fmt.Sprintf("daily-login:%s:%s", userID, dayKey),
		map[string]any{"action": "daily_login", "day": dayKey},
	); err != nil {
		return nil, err
	} else if applied {
		grantSummary.DailyLoginCoins = handler.cfg.DailyLoginCoins
	}

	balance, err := handler.fetchBalance(ctx, userID)
	if err != nil {
		return nil, err
	}
	if balance.Coins >= handler.cfg.LowBalanceFloorCoins {
		return grantSummary, nil
	}

	topUpCoins := handler.cfg.LowBalanceFloorCoins - balance.Coins
	if applied, err := handler.ensureGrant(
		ctx,
		userID,
		topUpCoins*handler.cfg.CoinValueCents,
		fmt.Sprintf("low-balance:%s:%s", userID, dayKey),
		map[string]any{"action": "low_balance_top_up", "day": dayKey, "top_up_coins": topUpCoins},
	); err != nil {
		return nil, err
	} else if applied {
		grantSummary.LowBalanceCoins = topUpCoins
	}

	return grantSummary, nil
}

func (handler *httpHandler) defaultRewardSummaryForOwner(_ *Puzzle) *RewardSummary {
	return &RewardSummary{
		OwnerRewardStatus:         "available",
		OwnerRewardClaimTotal:     0,
		SharedUniqueSolves:        0,
		CreatorCreditsEarned:      0,
		CreatorPuzzleCapRemaining: handler.cfg.CreatorSharedPerPuzzleCap,
		CreatorDailyCapRemaining:  handler.cfg.CreatorSharedDailyCap,
	}
}

func (handler *httpHandler) buildRewardSummary(puzzle *Puzzle, viewerUserID string, now time.Time) (*RewardSummary, error) {
	if puzzle == nil {
		return nil, nil
	}

	summary := handler.defaultRewardSummaryForOwner(puzzle)
	if viewerUserID != puzzle.UserID {
		summary.OwnerRewardStatus = "practice"
		return summary, nil
	}

	record, err := handler.store.GetPuzzleSolveRecord(puzzle.ID, viewerUserID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if record != nil {
		summary.OwnerRewardClaimTotal = record.SolverRewardCoins
		if record.SolverRewardCoins > 0 {
			summary.OwnerRewardStatus = "claimed"
		} else if record.IneligibilityReason != "" {
			summary.OwnerRewardStatus = "ineligible"
		}
	}

	dayStart, dayEnd := utcDayBounds(now)
	stats, err := handler.store.GetPuzzleRewardStats(puzzle.ID, puzzle.UserID, dayStart, dayEnd)
	if err != nil {
		return nil, err
	}
	summary.SharedUniqueSolves = stats.SharedUniqueSolves
	summary.CreatorCreditsEarned = stats.CreatorCreditsEarned
	summary.CreatorPuzzleCapRemaining = clampNonNegative(handler.cfg.CreatorSharedPerPuzzleCap - stats.CreatorCreditsEarned)
	summary.CreatorDailyCapRemaining = clampNonNegative(handler.cfg.CreatorSharedDailyCap - stats.CreatorCreditsEarnedToday)
	return summary, nil
}

func (handler *httpHandler) decorateOwnedPuzzle(puzzle *Puzzle, viewerUserID string, now time.Time) error {
	if puzzle == nil {
		return nil
	}
	summary, err := handler.buildRewardSummary(puzzle, viewerUserID, now)
	if err != nil {
		return err
	}
	puzzle.Source = "owned"
	puzzle.RewardSummary = summary
	return nil
}

// refundCredits grants back credits when a post-debit operation fails.
// Failures here are logged but not surfaced to the user since the primary
// error is already being returned.
func (handler *httpHandler) refundCredits(ctx context.Context, userID string, amountCents int64, reason string) {
	refundCtx, cancel := context.WithTimeout(ctx, handler.cfg.LedgerTimeout)
	defer cancel()

	_, err := handler.ledgerClient.Grant(refundCtx, &creditv1.GrantRequest{
		UserId:         userID,
		AmountCents:    amountCents,
		IdempotencyKey: fmt.Sprintf("refund:%s:%s", reason, uuid.NewString()),
		MetadataJson:   marshalMetadata(map[string]string{"action": "refund", "reason": reason}),
		LedgerId:       handler.cfg.DefaultLedgerID,
		TenantId:       handler.cfg.DefaultTenantID,
	})
	if err != nil {
		handler.logger.Error("refund grant failed",
			zap.String("user_id", userID),
			zap.Int64("amount_cents", amountCents),
			zap.String("reason", reason),
			zap.Error(err),
		)
	} else {
		handler.logger.Info("credits refunded",
			zap.String("user_id", userID),
			zap.Int64("amount_cents", amountCents),
			zap.String("reason", reason),
		)
	}
}

// --- helpers ---

func getClaims(ctx *gin.Context) *sessionvalidator.Claims {
	raw, exists := ctx.Get("auth_claims")
	if !exists {
		return nil
	}
	claims, ok := raw.(*sessionvalidator.Claims)
	if !ok {
		return nil
	}
	return claims
}

func errorResponse(code string, message string) gin.H {
	return gin.H{"error": code, "message": message}
}

func marshalMetadata(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func sanitizeTopic(topic string) string {
	topic = strings.TrimSpace(topic)
	// Remove control characters.
	var clean strings.Builder
	for _, r := range topic {
		if r >= 32 {
			clean.WriteRune(r)
		}
	}
	return strings.TrimSpace(clean.String())
}

func isGRPCAlreadyExists(err error) bool {
	return status.Code(err) == codes.AlreadyExists
}

func isGRPCInsufficientFunds(err error) bool {
	return status.Code(err) == codes.FailedPrecondition
}

func (handler *httpHandler) handleListPuzzles(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	puzzles, err := handler.store.ListPuzzlesByUser(claims.GetUserID())
	if err != nil {
		handler.logger.Error("list puzzles failed", zap.Error(err))
		ctx.JSON(http.StatusInternalServerError, errorResponse("db_error", "failed to list puzzles"))
		return
	}
	for index := range puzzles {
		if decorateErr := handler.decorateOwnedPuzzle(&puzzles[index], claims.GetUserID(), time.Now().UTC()); decorateErr != nil {
			handler.logger.Error("decorate puzzle failed", zap.Error(decorateErr), zap.String("puzzle_id", puzzles[index].ID))
			ctx.JSON(http.StatusInternalServerError, errorResponse("db_error", "failed to list puzzles"))
			return
		}
	}
	ctx.JSON(http.StatusOK, gin.H{"puzzles": puzzles})
}

func (handler *httpHandler) handleGetPuzzle(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	puzzle, err := handler.store.GetPuzzle(ctx.Param("id"), claims.GetUserID())
	if err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}
	if decorateErr := handler.decorateOwnedPuzzle(puzzle, claims.GetUserID(), time.Now().UTC()); decorateErr != nil {
		handler.logger.Error("decorate puzzle failed", zap.Error(decorateErr), zap.String("puzzle_id", puzzle.ID))
		ctx.JSON(http.StatusInternalServerError, errorResponse("db_error", "failed to load puzzle"))
		return
	}
	ctx.JSON(http.StatusOK, puzzle)
}

func (handler *httpHandler) handleGetSharedPuzzle(ctx *gin.Context) {
	puzzle, err := handler.store.GetPuzzleByShareToken(ctx.Param("token"))
	if err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}
	puzzle.Source = "shared"
	ctx.JSON(http.StatusOK, puzzle)
}

func (handler *httpHandler) handleDeletePuzzle(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	if err := handler.store.DeletePuzzle(ctx.Param("id"), claims.GetUserID()); err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"deleted": true})
}

func (handler *httpHandler) handleCompletePuzzle(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}

	var req completionRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "expected JSON body with used_hint and used_reveal"))
		return
	}

	puzzle, err := handler.store.GetPuzzle(ctx.Param("id"), claims.GetUserID())
	if err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}

	response, statusCode, completeErr := handler.completePuzzleSolve(ctx.Request.Context(), puzzle, claims.GetUserID(), req)
	if completeErr != nil {
		handler.logger.Error("complete puzzle failed", zap.Error(completeErr), zap.String("puzzle_id", puzzle.ID), zap.String("solver", claims.GetUserID()))
		ctx.JSON(statusCode, errorResponse("completion_error", "failed to record completion"))
		return
	}
	ctx.JSON(statusCode, response)
}

func (handler *httpHandler) handleCompleteSharedPuzzle(ctx *gin.Context) {
	var req completionRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "expected JSON body with used_hint and used_reveal"))
		return
	}

	puzzle, err := handler.store.GetPuzzleByShareToken(ctx.Param("token"))
	if err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}

	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusOK, &completionResponse{
			Mode:   "shared",
			Reason: "anonymous_solver",
		})
		return
	}

	response, statusCode, completeErr := handler.completePuzzleSolve(ctx.Request.Context(), puzzle, claims.GetUserID(), req)
	if completeErr != nil {
		handler.logger.Error("complete shared puzzle failed", zap.Error(completeErr), zap.String("puzzle_id", puzzle.ID), zap.String("solver", claims.GetUserID()))
		ctx.JSON(statusCode, errorResponse("completion_error", "failed to record completion"))
		return
	}
	ctx.JSON(statusCode, response)
}

func (handler *httpHandler) completePuzzleSolve(ctx context.Context, puzzle *Puzzle, solverUserID string, req completionRequest) (*completionResponse, int, error) {
	now := time.Now().UTC()
	dayStart, dayEnd := utcDayBounds(now)
	isOwner := puzzle != nil && puzzle.UserID == solverUserID
	mode := "shared"
	if isOwner {
		mode = "owner"
	}

	existingRecord, err := handler.store.GetPuzzleSolveRecord(puzzle.ID, solverUserID)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, http.StatusInternalServerError, err
	}
	if existingRecord != nil {
		response := &completionResponse{
			Mode: mode,
			Reward: completionRewardBreakdown{
				Base:        existingRecord.OwnerBaseRewardCoins,
				NoHintBonus: existingRecord.OwnerNoHintBonusCoins,
				DailyBonus:  existingRecord.OwnerDailyBonusCoins,
				Total:       existingRecord.SolverRewardCoins,
			},
			CreatorRewarded: existingRecord.CreatorRewardCoins > 0,
			CreatorCoins:    existingRecord.CreatorRewardCoins,
			Reason:          existingRecord.IneligibilityReason,
		}
		if response.Reason == "" {
			response.Reason = "already_recorded"
		}
		if isOwner {
			balance, balanceErr := handler.fetchBalance(ctx, solverUserID)
			if balanceErr != nil {
				return nil, http.StatusBadGateway, balanceErr
			}
			response.Balance = balance
			summary, summaryErr := handler.buildRewardSummary(puzzle, solverUserID, now)
			if summaryErr != nil {
				return nil, http.StatusInternalServerError, summaryErr
			}
			response.RewardSummary = summary
		}
		return response, http.StatusOK, nil
	}

	record := &PuzzleSolveRecord{
		PuzzleID:          puzzle.ID,
		PuzzleOwnerUserID: puzzle.UserID,
		SolverUserID:      solverUserID,
		Source:            mode,
		UsedHint:          req.UsedHint,
		UsedReveal:        req.UsedReveal,
	}
	response := &completionResponse{Mode: mode}

	if req.UsedReveal {
		record.IneligibilityReason = "revealed"
		if err := handler.store.CreatePuzzleSolveRecord(record); err != nil {
			return nil, http.StatusInternalServerError, err
		}
		response.Reason = record.IneligibilityReason
		if isOwner {
			balance, balanceErr := handler.fetchBalance(ctx, solverUserID)
			if balanceErr != nil {
				return nil, http.StatusBadGateway, balanceErr
			}
			response.Balance = balance
			summary, summaryErr := handler.buildRewardSummary(puzzle, solverUserID, now)
			if summaryErr != nil {
				return nil, http.StatusInternalServerError, summaryErr
			}
			response.RewardSummary = summary
		}
		return response, http.StatusOK, nil
	}

	if isOwner {
		record.OwnerBaseRewardCoins = handler.cfg.OwnerSolveCoins
		if !req.UsedHint {
			record.OwnerNoHintBonusCoins = handler.cfg.OwnerNoHintBonusCoins
		}
		qualifiedOwnerSolvesToday, countErr := handler.store.CountQualifiedOwnerSolvesByDay(solverUserID, dayStart, dayEnd)
		if countErr != nil {
			return nil, http.StatusInternalServerError, countErr
		}
		if qualifiedOwnerSolvesToday < handler.cfg.OwnerDailySolveBonusLimit {
			record.OwnerDailyBonusCoins = handler.cfg.OwnerDailySolveBonusCoins
		}
		record.SolverRewardCoins = record.OwnerBaseRewardCoins + record.OwnerNoHintBonusCoins + record.OwnerDailyBonusCoins
		response.Reward = completionRewardBreakdown{
			Base:        record.OwnerBaseRewardCoins,
			NoHintBonus: record.OwnerNoHintBonusCoins,
			DailyBonus:  record.OwnerDailyBonusCoins,
			Total:       record.SolverRewardCoins,
		}

		if _, grantErr := handler.ensureGrant(
			ctx,
			solverUserID,
			record.SolverRewardCoins*handler.cfg.CoinValueCents,
			fmt.Sprintf("owner-solve:%s:%s", puzzle.ID, solverUserID),
			map[string]any{
				"action":        "owner_solve_reward",
				"puzzle_id":     puzzle.ID,
				"used_hint":     req.UsedHint,
				"used_reveal":   req.UsedReveal,
				"base_coins":    record.OwnerBaseRewardCoins,
				"no_hint_coins": record.OwnerNoHintBonusCoins,
				"daily_bonus":   record.OwnerDailyBonusCoins,
			},
		); grantErr != nil {
			return nil, http.StatusBadGateway, grantErr
		}
	} else {
		stats, statsErr := handler.store.GetPuzzleRewardStats(puzzle.ID, puzzle.UserID, dayStart, dayEnd)
		if statsErr != nil {
			return nil, http.StatusInternalServerError, statsErr
		}
		switch {
		case stats.CreatorCreditsEarned >= handler.cfg.CreatorSharedPerPuzzleCap:
			record.IneligibilityReason = "creator_puzzle_cap_reached"
		case stats.CreatorCreditsEarnedToday >= handler.cfg.CreatorSharedDailyCap:
			record.IneligibilityReason = "creator_daily_cap_reached"
		default:
			record.CreatorRewardCoins = handler.cfg.CreatorSharedSolveCoins
			if _, grantErr := handler.ensureGrant(
				ctx,
				puzzle.UserID,
				record.CreatorRewardCoins*handler.cfg.CoinValueCents,
				fmt.Sprintf("shared-solve:%s:%s", puzzle.ID, solverUserID),
				map[string]any{
					"action":      "shared_creator_reward",
					"puzzle_id":   puzzle.ID,
					"solver_id":   solverUserID,
					"used_hint":   req.UsedHint,
					"used_reveal": req.UsedReveal,
				},
			); grantErr != nil {
				return nil, http.StatusBadGateway, grantErr
			}
			response.CreatorRewarded = true
			response.CreatorCoins = record.CreatorRewardCoins
		}
		response.Reason = record.IneligibilityReason
	}

	if err := handler.store.CreatePuzzleSolveRecord(record); err != nil {
		return nil, http.StatusInternalServerError, err
	}

	if isOwner {
		balance, balanceErr := handler.fetchBalance(ctx, solverUserID)
		if balanceErr != nil {
			return nil, http.StatusBadGateway, balanceErr
		}
		response.Balance = balance
		summary, summaryErr := handler.buildRewardSummary(puzzle, solverUserID, now)
		if summaryErr != nil {
			return nil, http.StatusInternalServerError, summaryErr
		}
		response.RewardSummary = summary
	}

	return response, http.StatusOK, nil
}

func (handler *httpHandler) handleAdminListUsers(ctx *gin.Context) {
	users, err := handler.store.ListAdminUsers()
	if err != nil {
		handler.logger.Error("admin list users failed", zap.Error(err))
		ctx.JSON(http.StatusOK, gin.H{"users": []AdminUser{}})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"users": users})
}

func (handler *httpHandler) handleAdminBalance(ctx *gin.Context) {
	userID := strings.TrimSpace(ctx.Query("user_id"))
	if userID == "" {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_user_id", "user_id query parameter is required"))
		return
	}
	balance, err := handler.fetchBalance(ctx.Request.Context(), userID)
	if err != nil {
		handler.logger.Error("admin balance fetch failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "balance unavailable"))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"balance": balance})
}

func (handler *httpHandler) handleAdminGrantHistory(ctx *gin.Context) {
	userID := strings.TrimSpace(ctx.Query("user_id"))
	if userID == "" {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_user_id", "user_id query parameter is required"))
		return
	}

	records, err := handler.store.ListAdminGrantRecords(userID, adminGrantHistoryLimit)
	if err != nil {
		handler.logger.Error("admin grant history failed", zap.Error(err), zap.String("target_user", userID))
		ctx.JSON(http.StatusInternalServerError, errorResponse("db_error", "grant history unavailable"))
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"grants": records})
}

func (handler *httpHandler) requireAdmin(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.AbortWithStatusJSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	// Allow access if the user's email is in the admin allowlist OR if TAuth
	// assigned them an "admin" role via session claims.
	if !handler.cfg.IsAdmin(claims.GetUserEmail()) && !hasRole(claims, "admin") {
		ctx.AbortWithStatusJSON(http.StatusForbidden, errorResponse("forbidden", "admin access required"))
		return
	}
	ctx.Next()
}

// hasRole checks whether the claims contain a specific role.
func hasRole(claims *sessionvalidator.Claims, role string) bool {
	for _, r := range claims.GetUserRoles() {
		if strings.EqualFold(r, role) {
			return true
		}
	}
	return false
}

type adminGrantRequest struct {
	UserID      string `json:"user_id"`
	UserEmail   string `json:"user_email"`
	AmountCoins int64  `json:"amount_coins"`
	Reason      string `json:"reason"`
}

func (handler *httpHandler) handleAdminGrant(ctx *gin.Context) {
	claims := getClaims(ctx)
	reason := ""
	targetEmail := ""
	metadata := map[string]any{}
	var grantRecord *AdminGrantRecord

	var req adminGrantRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_payload", "expected JSON body with user_id and amount_coins"))
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_user_id", "user_id is required"))
		return
	}
	if req.AmountCoins <= 0 {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_amount", "amount_coins must be positive"))
		return
	}
	reason = strings.TrimSpace(req.Reason)
	if reason == "" {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_reason", "reason is required"))
		return
	}
	if len(reason) > adminGrantReasonMaxLen {
		ctx.JSON(http.StatusBadRequest, errorResponse("invalid_reason", "reason must be 240 characters or fewer"))
		return
	}
	targetEmail = strings.TrimSpace(req.UserEmail)

	amountCents := req.AmountCoins * handler.cfg.CoinValueCents
	requestCtx, cancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LedgerTimeout)
	defer cancel()

	metadata["action"] = "admin_grant"
	metadata["admin_id"] = claims.GetUserID()
	metadata["admin_email"] = claims.GetUserEmail()
	metadata["reason"] = reason
	if targetEmail != "" {
		metadata["target_email"] = targetEmail
	}

	_, err := handler.ledgerClient.Grant(requestCtx, &creditv1.GrantRequest{
		UserId:           req.UserID,
		AmountCents:      amountCents,
		IdempotencyKey:   fmt.Sprintf("admin-grant:%s:%s", claims.GetUserID(), uuid.NewString()),
		MetadataJson:     marshalMetadata(metadata),
		ExpiresAtUnixUtc: 0,
		LedgerId:         handler.cfg.DefaultLedgerID,
		TenantId:         handler.cfg.DefaultTenantID,
	})
	if err != nil {
		handler.logger.Error("admin grant failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "grant failed"))
		return
	}

	grantRecord = &AdminGrantRecord{
		AdminUserID:  claims.GetUserID(),
		AdminEmail:   claims.GetUserEmail(),
		TargetUserID: req.UserID,
		TargetEmail:  targetEmail,
		AmountCoins:  req.AmountCoins,
		Reason:       reason,
	}
	if recordErr := handler.store.CreateAdminGrantRecord(grantRecord); recordErr != nil {
		handler.logger.Error("admin grant record save failed",
			zap.Error(recordErr),
			zap.String("admin", claims.GetUserEmail()),
			zap.String("target_user", req.UserID),
		)
		grantRecord = nil
	}

	handler.logger.Info("admin grant",
		zap.String("admin", claims.GetUserEmail()),
		zap.String("target_user", req.UserID),
		zap.Int64("coins", req.AmountCoins),
		zap.String("reason", reason),
	)

	// Return updated balance for the target user.
	balance, balanceErr := handler.fetchBalance(ctx.Request.Context(), req.UserID)
	if balanceErr != nil {
		handler.logger.Error("balance fetch after admin grant failed", zap.Error(balanceErr))
		ctx.JSON(http.StatusOK, gin.H{"granted": true, "grant": grantRecord})
		return
	}
	ctx.JSON(http.StatusOK, gin.H{"granted": true, "balance": balance, "grant": grantRecord})
}

func (handler *httpHandler) syncUserProfile(claims *sessionvalidator.Claims) {
	if claims == nil || handler.store == nil {
		return
	}

	err := handler.store.UpsertUserProfile(&UserProfile{
		UserID:      claims.GetUserID(),
		Email:       claims.GetUserEmail(),
		DisplayName: claims.GetUserDisplayName(),
		AvatarURL:   claims.GetUserAvatarURL(),
		LastSeenAt:  time.Now().UTC(),
	})
	if err != nil {
		handler.logger.Warn("user profile sync failed",
			zap.String("user_id", claims.GetUserID()),
			zap.String("email", claims.GetUserEmail()),
			zap.Error(err),
		)
	}
}

func waitForClientReady(ctx context.Context, conn *grpc.ClientConn) error {
	for {
		state := conn.GetState()
		if state == connectivity.Ready {
			return nil
		}
		if !conn.WaitForStateChange(ctx, state) {
			return fmt.Errorf("context cancelled while waiting for connection")
		}
	}
}
