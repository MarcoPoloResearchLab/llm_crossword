package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// withOnServerReady sets a callback invoked once the HTTP server is about to listen.
// This is only used in tests to get a reference to the server for controlled shutdown.
func withOnServerReady(f func(srv *http.Server)) RunOption {
	return func(o *runOptions) { o.onServerReady = f }
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

	api := router.Group("/api")
	api.Use(validator.GinMiddleware("auth_claims"))

	api.GET("/session", handler.handleSession)
	api.POST("/bootstrap", handler.handleBootstrap)
	api.GET("/balance", handler.handleBalance)
	api.POST("/generate", handler.handleGenerate)
	api.GET("/puzzles", handler.handleListPuzzles)
	api.GET("/puzzles/:id", handler.handleGetPuzzle)
	api.DELETE("/puzzles/:id", handler.handleDeletePuzzle)

	return router
}

type httpHandler struct {
	logger        *zap.Logger
	ledgerClient  creditv1.CreditServiceClient
	cfg           Config
	llmHTTPClient *http.Client
	store         Store
}

func (handler *httpHandler) handleSession(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	ctx.JSON(http.StatusOK, gin.H{
		"user_id":    claims.GetUserID(),
		"email":      claims.GetUserEmail(),
		"display":    claims.GetUserDisplayName(),
		"avatar_url": claims.GetUserAvatarURL(),
		"roles":      claims.GetUserRoles(),
		"expires":    claims.GetExpiresAt().Unix(),
	})
}

func (handler *httpHandler) handleBootstrap(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	requestCtx, cancel := context.WithTimeout(ctx.Request.Context(), handler.cfg.LedgerTimeout)
	defer cancel()

	if err := handler.ensureBootstrap(requestCtx, claims.GetUserID()); err != nil {
		handler.logger.Error("bootstrap grant failed", zap.Error(err))
		ctx.JSON(http.StatusBadGateway, errorResponse("ledger_error", "grant failed"))
		return
	}
	handler.respondWithBalance(ctx, claims.GetUserID())
}

func (handler *httpHandler) ensureBootstrap(ctx context.Context, userID string) error {
	// Idempotency is enforced by Ledger via the idempotency key.
	// If the user was already bootstrapped, Ledger returns AlreadyExists
	// which we treat as success.
	_, err := handler.ledgerClient.Grant(ctx, &creditv1.GrantRequest{
		UserId:           userID,
		AmountCents:      BootstrapAmountCents(),
		IdempotencyKey:   fmt.Sprintf("bootstrap:%s", userID),
		MetadataJson:     marshalMetadata(map[string]string{"action": "bootstrap"}),
		ExpiresAtUnixUtc: 0,
		LedgerId:         handler.cfg.DefaultLedgerID,
		TenantId:         handler.cfg.DefaultTenantID,
	})
	if err != nil && !isGRPCAlreadyExists(err) {
		return err
	}
	return nil
}

func (handler *httpHandler) handleBalance(ctx *gin.Context) {
	claims := getClaims(ctx)
	if claims == nil {
		ctx.JSON(http.StatusUnauthorized, errorResponse("unauthorized", "missing session"))
		return
	}
	handler.respondWithBalance(ctx, claims.GetUserID())
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
		AmountCents:    GenerateAmountCents(),
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
		ctx.JSON(http.StatusBadGateway, errorResponse("llm_error", "failed to generate words, please try again"))
		return
	}

	// Save puzzle to database.
	title := fmt.Sprintf("Crossword — %s", topic)
	subtitle := fmt.Sprintf("Generated from %q topic.", topic)
	puzzle := &Puzzle{
		UserID:   claims.GetUserID(),
		Title:    title,
		Subtitle: subtitle,
		Topic:    topic,
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

	ctx.JSON(http.StatusOK, gin.H{
		"items":       items,
		"title":       title,
		"subtitle":    subtitle,
		"balance":     balance,
		"id":          puzzle.ID,
		"share_token": puzzle.ShareToken,
	})
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
	TotalCents     int64 `json:"total_cents"`
	AvailableCents int64 `json:"available_cents"`
	Coins          int64 `json:"coins"`
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
		TotalCents:     resp.GetTotalCents(),
		AvailableCents: resp.GetAvailableCents(),
		Coins:          resp.GetAvailableCents() / CoinValueCents(),
	}, nil
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
	ctx.JSON(http.StatusOK, puzzle)
}

func (handler *httpHandler) handleGetSharedPuzzle(ctx *gin.Context) {
	puzzle, err := handler.store.GetPuzzleByShareToken(ctx.Param("token"))
	if err != nil {
		ctx.JSON(http.StatusNotFound, errorResponse("not_found", "puzzle not found"))
		return
	}
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
