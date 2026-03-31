package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/tyemirov/tauth/pkg/sessionvalidator"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

// --- mock ledger client ---

type mockLedgerClient struct {
	grantFunc      func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error)
	spendFunc      func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error)
	getBalanceFunc func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error)
}

func (m *mockLedgerClient) Grant(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
	if m.grantFunc != nil {
		return m.grantFunc(ctx, in, opts...)
	}
	return &creditv1.Empty{}, nil
}

func (m *mockLedgerClient) Spend(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
	if m.spendFunc != nil {
		return m.spendFunc(ctx, in, opts...)
	}
	return &creditv1.Empty{}, nil
}

func (m *mockLedgerClient) GetBalance(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
	if m.getBalanceFunc != nil {
		return m.getBalanceFunc(ctx, in, opts...)
	}
	return &creditv1.BalanceResponse{TotalCents: 2000, AvailableCents: 1500}, nil
}

// Unused interface methods — satisfy the interface.
func (m *mockLedgerClient) Reserve(ctx context.Context, in *creditv1.ReserveRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
	return &creditv1.Empty{}, nil
}
func (m *mockLedgerClient) Capture(ctx context.Context, in *creditv1.CaptureRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
	return &creditv1.Empty{}, nil
}
func (m *mockLedgerClient) Release(ctx context.Context, in *creditv1.ReleaseRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
	return &creditv1.Empty{}, nil
}
func (m *mockLedgerClient) Refund(ctx context.Context, in *creditv1.RefundRequest, opts ...grpc.CallOption) (*creditv1.RefundResponse, error) {
	return &creditv1.RefundResponse{}, nil
}
func (m *mockLedgerClient) Batch(ctx context.Context, in *creditv1.BatchRequest, opts ...grpc.CallOption) (*creditv1.BatchResponse, error) {
	return &creditv1.BatchResponse{}, nil
}
func (m *mockLedgerClient) ListEntries(ctx context.Context, in *creditv1.ListEntriesRequest, opts ...grpc.CallOption) (*creditv1.ListEntriesResponse, error) {
	return &creditv1.ListEntriesResponse{}, nil
}
func (m *mockLedgerClient) GetReservation(ctx context.Context, in *creditv1.GetReservationRequest, opts ...grpc.CallOption) (*creditv1.GetReservationResponse, error) {
	return &creditv1.GetReservationResponse{}, nil
}
func (m *mockLedgerClient) ListReservations(ctx context.Context, in *creditv1.ListReservationsRequest, opts ...grpc.CallOption) (*creditv1.ListReservationsResponse, error) {
	return &creditv1.ListReservationsResponse{}, nil
}

// --- test helpers ---

func testConfig() Config {
	return Config{
		ListenAddr:        ":0",
		LedgerAddress:     "localhost:50051",
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		LedgerSecretKey:   "test-secret",
		DefaultTenantID:   "tenant-1",
		DefaultLedgerID:   "ledger-1",
		AllowedOrigins:    []string{"http://localhost:8000"},
		SessionSigningKey: "test-secret-key-that-is-long-enough",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "test-key",
		LLMProxyTimeout:   30 * time.Second,
	}
}

func testHandler(ledger *mockLedgerClient, llmServer *httptest.Server) *httpHandler {
	return testHandlerWithStore(ledger, llmServer, nil)
}

func testHandlerWithStore(ledger *mockLedgerClient, llmServer *httptest.Server, s Store) *httpHandler {
	return testHandlerWithConfig(ledger, llmServer, s, testConfig())
}

func testHandlerWithConfig(ledger *mockLedgerClient, llmServer *httptest.Server, s Store, cfg Config) *httpHandler {
	logger, _ := zap.NewDevelopment()
	if llmServer != nil {
		cfg.LLMProxyURL = llmServer.URL
	}
	if err := cfg.Validate(); err != nil {
		panic(err)
	}
	if s == nil {
		s, _ = OpenDatabase(":memory:")
	}
	h := &httpHandler{
		logger:        logger,
		ledgerClient:  ledger,
		cfg:           cfg,
		llmHTTPClient: &http.Client{Timeout: 5 * time.Second},
		store:         s,
	}
	if llmServer != nil {
		h.llmHTTPClient = llmServer.Client()
	}
	return h
}

// testRouterWithClaims creates a gin router that injects claims into context,
// bypassing real JWT validation.
func testRouterWithClaims(handler *httpHandler, claims *sessionvalidator.Claims) *gin.Engine {
	gin.SetMode(gin.TestMode)
	router := gin.New()

	// Inject claims middleware (simulates what sessionvalidator.GinMiddleware does).
	router.Use(func(ctx *gin.Context) {
		if claims != nil {
			ctx.Set("auth_claims", claims)
		}
		ctx.Next()
	})

	router.GET("/healthz", func(ctx *gin.Context) {
		ctx.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/config.yml", handler.handlePublicConfig)
	router.GET("/api/session", handler.handleSession)
	router.POST("/api/bootstrap", handler.handleBootstrap)
	router.GET("/api/balance", handler.handleBalance)
	router.GET("/api/billing/summary", handler.handleBillingSummary)
	router.POST("/api/billing/checkout", handler.handleBillingCheckout)
	router.POST("/api/billing/portal", handler.handleBillingPortal)
	router.POST("/api/billing/paddle/webhook", handler.handleBillingWebhook)
	router.POST("/api/generate", handler.handleGenerate)
	router.GET("/api/puzzles", handler.handleListPuzzles)
	router.GET("/api/puzzles/:id", handler.handleGetPuzzle)
	router.POST("/api/puzzles/:id/complete", handler.handleCompletePuzzle)
	router.DELETE("/api/puzzles/:id", handler.handleDeletePuzzle)
	router.GET("/api/shared/:token", handler.handleGetSharedPuzzle)
	router.POST("/api/shared/:token/complete", handler.handleCompleteSharedPuzzle)

	admin := router.Group("/api/admin")
	admin.Use(handler.requireAdmin)
	admin.GET("/users", handler.handleAdminListUsers)
	admin.GET("/balance", handler.handleAdminBalance)
	admin.GET("/grants", handler.handleAdminGrantHistory)
	admin.POST("/grant", handler.handleAdminGrant)

	return router
}

func testClaims() *sessionvalidator.Claims {
	return &sessionvalidator.Claims{
		UserID:          "user-123",
		UserEmail:       "user@example.com",
		UserDisplayName: "Test User",
		UserAvatarURL:   "https://example.com/avatar.png",
		UserRoles:       []string{"user"},
	}
}

func doRequest(router *gin.Engine, method, path string, body string) *httptest.ResponseRecorder {
	return doRequestWithCookies(router, method, path, body)
}

func doRequestWithCookies(router *gin.Engine, method, path string, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func testSessionCookie(t *testing.T, cfg Config, claims *sessionvalidator.Claims) *http.Cookie {
	t.Helper()

	tokenClaims := *claims
	tokenClaims.RegisteredClaims = jwt.RegisteredClaims{
		Issuer:    cfg.SessionIssuer,
		IssuedAt:  jwt.NewNumericDate(time.Now().Add(-time.Minute)),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, &tokenClaims)
	signedToken, err := token.SignedString([]byte(cfg.SessionSigningKey))
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}

	return &http.Cookie{
		Name:  cfg.SessionCookieName,
		Value: signedToken,
	}
}

func TestOptionalSessionMiddleware_UsesDefaultContextKey(t *testing.T) {
	cfg := testConfig()
	validator, err := newTestValidator(cfg)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}

	router := gin.New()
	router.GET(
		"/session",
		optionalSessionMiddleware(validator, "   "),
		func(ctx *gin.Context) {
			rawClaims, exists := ctx.Get(sessionvalidator.DefaultContextKey)
			if !exists {
				t.Fatal("expected claims under default context key")
			}

			claims, ok := rawClaims.(*sessionvalidator.Claims)
			if !ok {
				t.Fatalf("expected *sessionvalidator.Claims, got %T", rawClaims)
			}
			if claims.GetUserID() != "solver-1" {
				t.Fatalf("expected solver-1, got %q", claims.GetUserID())
			}

			ctx.Status(http.StatusNoContent)
		},
	)

	cookie := testSessionCookie(t, cfg, &sessionvalidator.Claims{UserID: "solver-1"})
	response := doRequestWithCookies(router, http.MethodGet, "/session", "", cookie)
	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", response.Code)
	}
}

func TestHandlePublicConfig_ServesConfiguredDocument(t *testing.T) {
	tempDir := t.TempDir()
	configPath := tempDir + "/config.yml"
	configBody := "billing:\n  packs: []\n"
	if err := os.WriteFile(configPath, []byte(configBody), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg := testConfig()
	cfg.PublicConfigPath = configPath
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, cfg)
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodGet, "/config.yml", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if got := response.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("expected Cache-Control no-store, got %q", got)
	}
	if !strings.Contains(response.Body.String(), "billing:") {
		t.Fatalf("expected config body, got %q", response.Body.String())
	}
}

func TestHandlePublicConfig_InterpolatesEnvironmentVariables(t *testing.T) {
	t.Setenv("GOOGLE_CLIENT_ID", "google-client-id-from-env")

	tempDir := t.TempDir()
	configPath := tempDir + "/config.yml"
	configBody := "auth:\n  googleClientId: ${GOOGLE_CLIENT_ID}\n"
	if err := os.WriteFile(configPath, []byte(configBody), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg := testConfig()
	cfg.PublicConfigPath = configPath
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, cfg)
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodGet, "/config.yml", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), "google-client-id-from-env") {
		t.Fatalf("expected expanded config body, got %q", response.Body.String())
	}
}

func TestHandlePublicConfig_FailsWhenEnvironmentVariableIsMissing(t *testing.T) {
	tempDir := t.TempDir()
	configPath := tempDir + "/config.yml"
	configBody := "auth:\n  googleClientId: ${MISSING_GOOGLE_CLIENT_ID}\n"
	if err := os.WriteFile(configPath, []byte(configBody), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	cfg := testConfig()
	cfg.PublicConfigPath = configPath
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, cfg)
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodGet, "/config.yml", "")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", response.Code, response.Body.String())
	}
}

func TestHandlePublicConfig_NotFoundWhenUnset(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, testConfig())
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodGet, "/config.yml", "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", response.Code, response.Body.String())
	}
}

func testLLMResponseServer(t *testing.T, responses ...string) *httptest.Server {
	t.Helper()

	callIndex := 0
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if callIndex >= len(responses) {
			http.Error(w, "unexpected extra llm call", http.StatusInternalServerError)
			return
		}

		response := llmProxyResponse{
			Request:  "test",
			Response: responses[callIndex],
		}
		callIndex++
		json.NewEncoder(w).Encode(response)
	}))
}

func decodeJSONMap(t *testing.T, body string) map[string]any {
	t.Helper()

	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		t.Fatalf("json.Unmarshal: %v", err)
	}
	return payload
}

// --- tests ---

func TestHealthz(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "GET", "/healthz", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestHandleSession_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "GET", "/api/session", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleSession_WithClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	claims := testClaims()
	router := testRouterWithClaims(handler, claims)
	w := doRequest(router, "GET", "/api/session", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["user_id"] != "user-123" {
		t.Errorf("expected user_id user-123, got %v", resp["user_id"])
	}
	if resp["email"] != "user@example.com" {
		t.Errorf("expected email user@example.com, got %v", resp["email"])
	}
}

func TestHandleBootstrap_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "POST", "/api/bootstrap", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleBootstrap_Success(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/bootstrap", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleBootstrap_GrantSummaryIncludesBootstrapAndDailyLogin(t *testing.T) {
	var availableCents int64
	var grantKeys []string

	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantKeys = append(grantKeys, in.GetIdempotencyKey())
			availableCents += in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: availableCents, AvailableCents: availableCents}, nil
		},
	}

	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/bootstrap", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	grants := body["grants"].(map[string]any)
	balance := body["balance"].(map[string]any)

	if grants["bootstrap_coins"].(float64) != 30 {
		t.Fatalf("expected bootstrap grant of 30, got %v", grants["bootstrap_coins"])
	}
	if grants["daily_login_coins"].(float64) != 8 {
		t.Fatalf("expected daily grant of 8, got %v", grants["daily_login_coins"])
	}
	if grants["low_balance_coins"].(float64) != 0 {
		t.Fatalf("expected no low-balance grant, got %v", grants["low_balance_coins"])
	}
	if balance["coins"].(float64) != 38 {
		t.Fatalf("expected 38 coins after grants, got %v", balance["coins"])
	}
	if balance["generation_cost_coins"].(float64) != 4 {
		t.Fatalf("expected generation cost of 4 coins, got %v", balance["generation_cost_coins"])
	}
	if len(grantKeys) != 2 {
		t.Fatalf("expected 2 grant calls, got %d", len(grantKeys))
	}
}

func TestHandleBootstrap_LowBalanceTopUp(t *testing.T) {
	var availableCents int64 = 100

	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			availableCents += in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: availableCents, AvailableCents: availableCents}, nil
		},
	}

	handler := testHandler(ledger, nil)
	handler.cfg.BootstrapCoins = 0
	handler.cfg.DailyLoginCoins = 0
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/bootstrap", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	grants := body["grants"].(map[string]any)
	balance := body["balance"].(map[string]any)

	if grants["low_balance_coins"].(float64) != 3 {
		t.Fatalf("expected 3 low-balance coins, got %v", grants["low_balance_coins"])
	}
	if balance["coins"].(float64) != 4 {
		t.Fatalf("expected balance to top up to 4 coins, got %v", balance["coins"])
	}
	if balance["generation_cost_coins"].(float64) != 4 {
		t.Fatalf("expected generation cost of 4 coins, got %v", balance["generation_cost_coins"])
	}
}

func TestHandleBootstrap_AlreadyExists(t *testing.T) {
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, status.Error(codes.AlreadyExists, "already granted")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/bootstrap", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (idempotent), got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleBootstrap_GrantError(t *testing.T) {
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, status.Error(codes.Internal, "db down")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/bootstrap", "")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleBootstrap_BalanceError(t *testing.T) {
	var balanceCalls int
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			balanceCalls++
			if balanceCalls == 1 {
				return &creditv1.BalanceResponse{TotalCents: 3800, AvailableCents: 3800}, nil
			}
			return nil, errors.New("balance failed")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/bootstrap", "")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleBalance_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "GET", "/api/balance", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleBalance_Success(t *testing.T) {
	ledger := &mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: 2000, AvailableCents: 1500}, nil
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "GET", "/api/balance", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	balance := resp["balance"].(map[string]any)
	if balance["coins"].(float64) != 15 {
		t.Errorf("expected 15 coins, got %v", balance["coins"])
	}
	if balance["generation_cost_coins"].(float64) != 4 {
		t.Errorf("expected generation cost of 4 coins, got %v", balance["generation_cost_coins"])
	}
}

func TestHandleBalance_LedgerError(t *testing.T) {
	ledger := &mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, fmt.Errorf("connection refused")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "GET", "/api/balance", "")
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleGenerate_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test"}`)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestHandleGenerate_InvalidJSON(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", "not json")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleGenerate_MissingRequestID(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"topic":"test","word_count":8}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if body["error"] != "invalid_request_id" {
		t.Fatalf("expected invalid_request_id, got %v", body["error"])
	}
}

func TestHandleGenerate_EmptyTopic(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"","word_count":8}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleGenerate_TopicTooLong(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	longTopic := strings.Repeat("a", 201)
	body := fmt.Sprintf(`{"request_id":"req-1","topic":%q,"word_count":8}`, longTopic)
	w := doRequest(router, "POST", "/api/generate", body)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleGenerate_InsufficientCredits(t *testing.T) {
	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, status.Error(codes.FailedPrecondition, "insufficient funds")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusPaymentRequired {
		t.Fatalf("expected 402, got %d", w.Code)
	}
}

func TestHandleGenerate_SpendError(t *testing.T) {
	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, status.Error(codes.Internal, "db error")
		},
	}
	handler := testHandler(ledger, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleGenerate_LLMError(t *testing.T) {
	ledger := &mockLedgerClient{}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("llm down"))
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleGenerate_Success(t *testing.T) {
	ledger := &mockLedgerClient{}
	items := makeWordItems(8)
	metadata := PuzzleMetadata{
		Title:       "Olympian Power Network",
		Subtitle:    "Zeus and Hera anchor a tightly focused set of Olympian deity answers.",
		Description: "This puzzle centers on prominent Olympian figures and the shared mythology that connects their roles, symbols, and relationships.",
	}
	llmServer := testLLMResponseServer(t, mustMarshalJSON(items), mustMarshalJSON(metadata))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	respItems, ok := resp["items"].([]any)
	if !ok || len(respItems) != 8 {
		t.Fatalf("expected 8 items, got %v", resp["items"])
	}
	if resp["title"] != metadata.Title {
		t.Fatalf("expected title %q, got %v", metadata.Title, resp["title"])
	}
	if resp["subtitle"] != metadata.Subtitle {
		t.Fatalf("expected subtitle %q, got %v", metadata.Subtitle, resp["subtitle"])
	}
	if resp["description"] != metadata.Description {
		t.Fatalf("expected description %q, got %v", metadata.Description, resp["description"])
	}
	balance, ok := resp["balance"].(map[string]any)
	if !ok {
		t.Fatalf("expected balance in response, got %T", resp["balance"])
	}
	if balance["generation_cost_coins"].(float64) != 4 {
		t.Fatalf("expected generation cost of 4 coins, got %v", balance["generation_cost_coins"])
	}
}

func TestHandleGenerate_UsesStableSpendIdempotencyKey(t *testing.T) {
	var capturedKey string

	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, in *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			capturedKey = in.GetIdempotencyKey()
			return &creditv1.Empty{}, nil
		},
	}
	items := makeWordItems(8)
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(llmProxyResponse{Response: mustMarshalJSON(items)})
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/generate", `{"request_id":"stable-request","topic":"Greek gods","word_count":8}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}
	if capturedKey != "generate:user-123:stable-request" {
		t.Fatalf("unexpected spend idempotency key %q", capturedKey)
	}
}

func TestHandleGenerate_MetadataRetrySucceeds(t *testing.T) {
	items := makeWordItems(8)
	metadata := PuzzleMetadata{
		Title:       "Roman Civic Core",
		Subtitle:    "The forum-focused answer set highlights the political and commercial heart of the city.",
		Description: "This puzzle emphasizes the public institutions and shared spaces that structured Roman urban life.",
	}
	llmServer := testLLMResponseServer(t, mustMarshalJSON(items), "not json", mustMarshalJSON(metadata))
	defer llmServer.Close()

	handler := testHandler(&mockLedgerClient{}, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Roman city","word_count":8}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]any
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body["title"] != metadata.Title {
		t.Fatalf("expected metadata retry title %q, got %v", metadata.Title, body["title"])
	}
	if body["description"] != metadata.Description {
		t.Fatalf("expected metadata retry description %q, got %v", metadata.Description, body["description"])
	}
}

func TestHandleGenerate_MetadataFailureFallsBackWithoutRefund(t *testing.T) {
	items := makeWordItems(8)
	var grantCalls int
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalls++
			return &creditv1.Empty{}, nil
		},
	}
	llmServer := testLLMResponseServer(t, mustMarshalJSON(items), "not json", `{"title":"still wrong"}`)
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Crossword city","word_count":8}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	if grantCalls != 0 {
		t.Fatalf("expected no refund for metadata-only failure, got %d grant calls", grantCalls)
	}

	var body map[string]any
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body["title"] != "city" {
		t.Fatalf("expected fallback title %q, got %v", "city", body["title"])
	}
	if body["subtitle"] != "" {
		t.Fatalf("expected empty fallback subtitle, got %v", body["subtitle"])
	}
	if body["description"] != "" {
		t.Fatalf("expected empty fallback description, got %v", body["description"])
	}
}

func TestHandleGenerate_WordCountClamping(t *testing.T) {
	tests := []struct {
		name      string
		wordCount int
	}{
		{"below minimum", 2},
		{"above maximum", 20},
		{"normal", 10},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ledger := &mockLedgerClient{}
			expectedWordCount := tt.wordCount
			if expectedWordCount < 5 {
				expectedWordCount = 8
			}
			if expectedWordCount > 15 {
				expectedWordCount = 15
			}
			items := makeWordItems(expectedWordCount)
			wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
			llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(wrapper)
			}))
			defer llmServer.Close()

			handler := testHandler(ledger, llmServer)
			router := testRouterWithClaims(handler, testClaims())
			body := fmt.Sprintf(`{"request_id":"req-1","topic":"test","word_count":%d}`, tt.wordCount)
			w := doRequest(router, "POST", "/api/generate", body)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestHandleGenerate_BalanceFetchFailsGracefully(t *testing.T) {
	ledger := &mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, fmt.Errorf("balance unavailable")
		},
	}
	items := makeWordItems(8)
	wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
	// Should still succeed even if balance fetch fails.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleListAndGetPuzzle_IncludeRewardSummary(t *testing.T) {
	puzzle := &Puzzle{
		ID:          "puzzle-1",
		UserID:      "user-123",
		Title:       "Owned puzzle",
		Subtitle:    "Stored",
		Description: "Stored puzzle description",
		Words: []PuzzleWord{
			{Word: "ORBIT", Clue: "Path", Hint: "ellipse"},
		},
	}
	store := &mockStore{
		listFunc: func(userID string) ([]Puzzle, error) {
			return []Puzzle{*puzzle}, nil
		},
		getFunc: func(id, userID string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return &PuzzleSolveRecord{
				PuzzleID:          puzzleID,
				PuzzleOwnerUserID: solverUserID,
				SolverUserID:      solverUserID,
				Source:            "owner",
				SolverRewardCoins: 4,
			}, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{
				SharedUniqueSolves:        2,
				CreatorCreditsEarned:      3,
				CreatorCreditsEarnedToday: 1,
			}, nil
		},
	}

	handler := testHandlerWithStore(&mockLedgerClient{}, nil, store)
	router := testRouterWithClaims(handler, testClaims())

	listResponse := doRequest(router, "GET", "/api/puzzles", "")
	if listResponse.Code != http.StatusOK {
		t.Fatalf("expected list 200, got %d: %s", listResponse.Code, listResponse.Body.String())
	}
	listBody := decodeJSONMap(t, listResponse.Body.String())
	puzzles := listBody["puzzles"].([]any)
	firstPuzzle := puzzles[0].(map[string]any)
	listRewardSummary := firstPuzzle["reward_summary"].(map[string]any)

	if firstPuzzle["source"] != "owned" {
		t.Fatalf("expected owned source, got %v", firstPuzzle["source"])
	}
	if listRewardSummary["owner_reward_status"] != "claimed" {
		t.Fatalf("expected claimed owner reward status, got %v", listRewardSummary["owner_reward_status"])
	}
	if listRewardSummary["shared_unique_solves"].(float64) != 2 {
		t.Fatalf("expected 2 shared solves, got %v", listRewardSummary["shared_unique_solves"])
	}
	if listRewardSummary["creator_credits_earned"].(float64) != 3 {
		t.Fatalf("expected 3 creator credits earned, got %v", listRewardSummary["creator_credits_earned"])
	}

	getResponse := doRequest(router, "GET", "/api/puzzles/puzzle-1", "")
	if getResponse.Code != http.StatusOK {
		t.Fatalf("expected get 200, got %d: %s", getResponse.Code, getResponse.Body.String())
	}
	getBody := decodeJSONMap(t, getResponse.Body.String())
	detailRewardSummary := getBody["reward_summary"].(map[string]any)
	if detailRewardSummary["creator_daily_cap_remaining"].(float64) != 19 {
		t.Fatalf("expected 19 creator daily credits remaining, got %v", detailRewardSummary["creator_daily_cap_remaining"])
	}
	if detailRewardSummary["creator_puzzle_cap_remaining"].(float64) != 7 {
		t.Fatalf("expected 7 creator puzzle cap remaining, got %v", detailRewardSummary["creator_puzzle_cap_remaining"])
	}
}

func TestHandleCompletePuzzle_OwnerRewardBreakdown(t *testing.T) {
	var availableCents int64 = 2000
	var recordedSolve *PuzzleSolveRecord
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-123", Title: "Owned"}
	store := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			if recordedSolve == nil {
				return nil, gorm.ErrRecordNotFound
			}
			return recordedSolve, nil
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			copy := *record
			recordedSolve = &copy
			return nil
		},
		countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
			return 0, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			availableCents += in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: availableCents, AvailableCents: availableCents}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/puzzles/puzzle-1/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	reward := body["reward"].(map[string]any)
	rewardSummary := body["reward_summary"].(map[string]any)

	if body["mode"] != "owner" {
		t.Fatalf("expected owner mode, got %v", body["mode"])
	}
	if reward["base"].(float64) != 3 || reward["no_hint_bonus"].(float64) != 1 || reward["daily_bonus"].(float64) != 1 {
		t.Fatalf("unexpected reward breakdown: %#v", reward)
	}
	if reward["total"].(float64) != 5 {
		t.Fatalf("expected 5 total credits, got %v", reward["total"])
	}
	if body["balance"].(map[string]any)["coins"].(float64) != 25 {
		t.Fatalf("expected updated balance of 25, got %v", body["balance"].(map[string]any)["coins"])
	}
	if recordedSolve == nil {
		t.Fatal("expected solve record to be stored")
	}
	if recordedSolve.SolverRewardCoins != 5 {
		t.Fatalf("expected stored solve reward of 5, got %d", recordedSolve.SolverRewardCoins)
	}
	if rewardSummary["owner_reward_status"] != "claimed" {
		t.Fatalf("expected claimed reward summary, got %v", rewardSummary["owner_reward_status"])
	}
}

func TestHandleCompletePuzzle_OwnerHintUsedGetsBaseOnly(t *testing.T) {
	var availableCents int64 = 1000
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-123", Title: "Owned"}
	store := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, gorm.ErrRecordNotFound
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error { return nil },
		countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
			return 3, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			availableCents += in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: availableCents, AvailableCents: availableCents}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/puzzles/puzzle-1/complete", `{"used_hint":true,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	reward := body["reward"].(map[string]any)
	if reward["base"].(float64) != 3 {
		t.Fatalf("expected base reward 3, got %v", reward["base"])
	}
	if reward["no_hint_bonus"].(float64) != 0 || reward["daily_bonus"].(float64) != 0 {
		t.Fatalf("expected no bonus credits, got %#v", reward)
	}
	if reward["total"].(float64) != 3 {
		t.Fatalf("expected total reward 3, got %v", reward["total"])
	}
}

func TestHandleCompletePuzzle_RevealCreatesIneligibleRecord(t *testing.T) {
	var grantCalls int
	var recordedSolve *PuzzleSolveRecord
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-123", Title: "Owned"}
	store := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			if recordedSolve == nil {
				return nil, gorm.ErrRecordNotFound
			}
			return recordedSolve, nil
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			copy := *record
			recordedSolve = &copy
			return nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalls++
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: 1200, AvailableCents: 1200}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/puzzles/puzzle-1/complete", `{"used_hint":false,"used_reveal":true}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["reason"] != "revealed" {
		t.Fatalf("expected revealed reason, got %v", body["reason"])
	}
	if grantCalls != 0 {
		t.Fatalf("expected no grant calls after reveal, got %d", grantCalls)
	}
	if recordedSolve == nil || recordedSolve.IneligibilityReason != "revealed" {
		t.Fatalf("expected revealed solve record, got %#v", recordedSolve)
	}
	if body["reward_summary"].(map[string]any)["owner_reward_status"] != "ineligible" {
		t.Fatalf("expected ineligible reward summary, got %v", body["reward_summary"].(map[string]any)["owner_reward_status"])
	}
}

func TestHandleCompletePuzzle_DuplicateDoesNotGrantTwice(t *testing.T) {
	var grantCalls int
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-123", Title: "Owned"}
	store := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return &PuzzleSolveRecord{
				PuzzleID:              puzzleID,
				PuzzleOwnerUserID:     solverUserID,
				SolverUserID:          solverUserID,
				Source:                "owner",
				OwnerBaseRewardCoins:  3,
				OwnerNoHintBonusCoins: 1,
				OwnerDailyBonusCoins:  0,
				SolverRewardCoins:     4,
				IneligibilityReason:   "",
			}, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalls++
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: 2400, AvailableCents: 2400}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/puzzles/puzzle-1/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["reason"] != "already_recorded" {
		t.Fatalf("expected already_recorded reason, got %v", body["reason"])
	}
	if grantCalls != 0 {
		t.Fatalf("expected duplicate completion to skip grants, got %d grant calls", grantCalls)
	}
}

func TestHandleCompleteSharedPuzzle_AnonymousSolverDoesNotAffectCredits(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
	store := &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return puzzle, nil
		},
	}

	handler := testHandlerWithStore(&mockLedgerClient{}, nil, store)
	router := testRouterWithClaims(handler, nil)
	response := doRequest(router, "POST", "/api/shared/shared-token/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["reason"] != "anonymous_solver" {
		t.Fatalf("expected anonymous_solver reason, got %v", body["reason"])
	}
}

func TestSetupRouter_HandleCompleteSharedPuzzle_AllowsAnonymousWithoutSession(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
	store := &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return puzzle, nil
		},
	}

	handler := testHandlerWithStore(&mockLedgerClient{}, nil, store)
	validator, err := newTestValidator(handler.cfg)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	router := setupRouter(handler.cfg, handler, validator)

	response := doRequest(router, "POST", "/api/shared/shared-token/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["reason"] != "anonymous_solver" {
		t.Fatalf("expected anonymous_solver reason, got %v", body["reason"])
	}
}

func TestHandleCompleteSharedPuzzle_PaysCreatorOnce(t *testing.T) {
	var grantUserID string
	var grantAmount int64
	var recordedSolve *PuzzleSolveRecord
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
	solverClaims := &sessionvalidator.Claims{UserID: "solver-1"}
	store := &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, gorm.ErrRecordNotFound
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			copy := *record
			recordedSolve = &copy
			return nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantUserID = in.GetUserId()
			grantAmount = in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, solverClaims)
	response := doRequest(router, "POST", "/api/shared/shared-token/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["mode"] != "shared" {
		t.Fatalf("expected shared mode, got %v", body["mode"])
	}
	if body["creator_rewarded"] != true {
		t.Fatalf("expected creator_rewarded true, got %v", body["creator_rewarded"])
	}
	if body["creator_coins"].(float64) != 1 {
		t.Fatalf("expected creator reward of 1 coin, got %v", body["creator_coins"])
	}
	if grantUserID != "owner-1" || grantAmount != 100 {
		t.Fatalf("expected creator grant to owner-1 for 100 cents, got user=%q amount=%d", grantUserID, grantAmount)
	}
	if recordedSolve == nil || recordedSolve.CreatorRewardCoins != 1 {
		t.Fatalf("expected creator reward record, got %#v", recordedSolve)
	}
}

func TestCompletePuzzleSolve_SerializesSharedCreatorRewardCaps(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
	var stateMu sync.Mutex
	recordedSolves := map[string]*PuzzleSolveRecord{}
	grantStarted := make(chan struct{})
	releaseGrant := make(chan struct{})
	secondStarted := make(chan struct{})
	type solveOutcome struct {
		solver   string
		response *completionResponse
		status   int
		err      error
	}
	outcomes := make(chan solveOutcome, 2)
	grantCalls := 0

	store := &mockStore{
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			stateMu.Lock()
			defer stateMu.Unlock()
			record, ok := recordedSolves[solverUserID]
			if !ok {
				return nil, gorm.ErrRecordNotFound
			}
			copyRecord := *record
			return &copyRecord, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			stateMu.Lock()
			defer stateMu.Unlock()
			stats := &PuzzleRewardStats{}
			for _, record := range recordedSolves {
				stats.CreatorCreditsEarned += record.CreatorRewardCoins
				stats.CreatorCreditsEarnedToday += record.CreatorRewardCoins
			}
			return stats, nil
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			stateMu.Lock()
			defer stateMu.Unlock()
			copyRecord := *record
			recordedSolves[record.SolverUserID] = &copyRecord
			return nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			stateMu.Lock()
			grantCalls++
			currentGrantCall := grantCalls
			stateMu.Unlock()

			if currentGrantCall == 1 {
				close(grantStarted)
				<-releaseGrant
			}
			return &creditv1.Empty{}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	handler.cfg.CreatorSharedPerPuzzleCap = 1
	handler.cfg.CreatorSharedDailyCap = 1

	runSolve := func(solverUserID string, started chan<- struct{}) {
		if started != nil {
			close(started)
		}
		response, statusCode, err := handler.completePuzzleSolve(context.Background(), puzzle, solverUserID, completionRequest{})
		outcomes <- solveOutcome{
			solver:   solverUserID,
			response: response,
			status:   statusCode,
			err:      err,
		}
	}

	go runSolve("solver-1", nil)
	<-grantStarted
	go runSolve("solver-2", secondStarted)
	<-secondStarted
	close(releaseGrant)

	firstOutcome := <-outcomes
	secondOutcome := <-outcomes
	for _, outcome := range []solveOutcome{firstOutcome, secondOutcome} {
		if outcome.err != nil {
			t.Fatalf("unexpected error for %s: %v", outcome.solver, outcome.err)
		}
		if outcome.status != http.StatusOK {
			t.Fatalf("unexpected status for %s: %d", outcome.solver, outcome.status)
		}
	}

	if grantCalls != 1 {
		t.Fatalf("expected exactly one creator grant, got %d", grantCalls)
	}

	outcomeBySolver := map[string]solveOutcome{
		firstOutcome.solver:  firstOutcome,
		secondOutcome.solver: secondOutcome,
	}
	if !outcomeBySolver["solver-1"].response.CreatorRewarded {
		t.Fatalf("expected first solver to reward creator, got %#v", outcomeBySolver["solver-1"].response)
	}
	if outcomeBySolver["solver-2"].response.CreatorRewarded {
		t.Fatalf("expected second solver to skip creator reward, got %#v", outcomeBySolver["solver-2"].response)
	}
	if outcomeBySolver["solver-2"].response.Reason != "creator_puzzle_cap_reached" {
		t.Fatalf("expected cap reason for second solver, got %#v", outcomeBySolver["solver-2"].response)
	}
}

func TestCompletePuzzleSolve_SharedRecheckReturnsExistingRecord(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", Title: "Shared"}
	lookupCalls := 0
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			lookupCalls++
			if lookupCalls == 1 {
				return nil, gorm.ErrRecordNotFound
			}
			return &PuzzleSolveRecord{
				PuzzleID:           puzzleID,
				PuzzleOwnerUserID:  "owner-1",
				SolverUserID:       solverUserID,
				Source:             "shared",
				CreatorRewardCoins: 1,
			}, nil
		},
	})

	response, statusCode, err := handler.completePuzzleSolve(context.Background(), puzzle, "solver-1", completionRequest{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if statusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", statusCode)
	}
	if !response.CreatorRewarded {
		t.Fatalf("expected creator reward replay response, got %#v", response)
	}
	if response.Reason != "already_recorded" {
		t.Fatalf("expected already_recorded reason, got %#v", response)
	}
	if lookupCalls != 2 {
		t.Fatalf("expected two lookup calls, got %d", lookupCalls)
	}
}

func TestSetupRouter_HandleCompleteSharedPuzzle_UsesSessionWhenPresent(t *testing.T) {
	var grantUserID string
	var grantAmount int64
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
	store := &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, gorm.ErrRecordNotFound
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			return nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantUserID = in.GetUserId()
			grantAmount = in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	validator, err := newTestValidator(handler.cfg)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}
	router := setupRouter(handler.cfg, handler, validator)
	cookie := testSessionCookie(t, handler.cfg, &sessionvalidator.Claims{UserID: "solver-1"})

	response := doRequestWithCookies(
		router,
		"POST",
		"/api/shared/shared-token/complete",
		`{"used_hint":false,"used_reveal":false}`,
		cookie,
	)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	if body["mode"] != "shared" {
		t.Fatalf("expected shared mode, got %v", body["mode"])
	}
	if body["creator_rewarded"] != true {
		t.Fatalf("expected creator_rewarded true, got %v", body["creator_rewarded"])
	}
	if grantUserID != "owner-1" || grantAmount != 100 {
		t.Fatalf("expected creator grant to owner-1 for 100 cents, got user=%q amount=%d", grantUserID, grantAmount)
	}
}

func TestHandleCompleteSharedPuzzle_SelfSolveFallsBackToOwnerReward(t *testing.T) {
	var recordedSolve *PuzzleSolveRecord
	var availableCents int64 = 1500
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-123", ShareToken: "shared-token", Title: "Shared"}
	store := &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return puzzle, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			if recordedSolve == nil {
				return nil, gorm.ErrRecordNotFound
			}
			return recordedSolve, nil
		},
		createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
			copy := *record
			recordedSolve = &copy
			return nil
		},
		countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
			return 3, nil
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return &PuzzleRewardStats{}, nil
		},
	}
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			availableCents += in.GetAmountCents()
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: availableCents, AvailableCents: availableCents}, nil
		},
	}

	handler := testHandlerWithStore(ledger, nil, store)
	router := testRouterWithClaims(handler, testClaims())
	response := doRequest(router, "POST", "/api/shared/shared-token/complete", `{"used_hint":false,"used_reveal":false}`)
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
	}

	body := decodeJSONMap(t, response.Body.String())
	reward := body["reward"].(map[string]any)
	if body["mode"] != "owner" {
		t.Fatalf("expected owner mode for self-solve, got %v", body["mode"])
	}
	if reward["total"].(float64) != 4 {
		t.Fatalf("expected self-solve reward of 4, got %v", reward["total"])
	}
	if body["creator_rewarded"] != false {
		t.Fatalf("expected no creator reward on self-solve, got %v", body["creator_rewarded"])
	}
}

func TestHandleCompleteSharedPuzzle_NoPayoutReasons(t *testing.T) {
	tests := []struct {
		name           string
		requestBody    string
		existingRecord *PuzzleSolveRecord
		rewardStats    *PuzzleRewardStats
		wantReason     string
	}{
		{
			name:        "duplicate solver",
			requestBody: `{"used_hint":false,"used_reveal":false}`,
			existingRecord: &PuzzleSolveRecord{
				PuzzleID:           "puzzle-1",
				PuzzleOwnerUserID:  "owner-1",
				SolverUserID:       "solver-1",
				Source:             "shared",
				CreatorRewardCoins: 1,
			},
			wantReason: "already_recorded",
		},
		{
			name:        "reveal used",
			requestBody: `{"used_hint":false,"used_reveal":true}`,
			wantReason:  "revealed",
		},
		{
			name:        "puzzle cap reached",
			requestBody: `{"used_hint":false,"used_reveal":false}`,
			rewardStats: &PuzzleRewardStats{CreatorCreditsEarned: 10},
			wantReason:  "creator_puzzle_cap_reached",
		},
		{
			name:        "daily cap reached",
			requestBody: `{"used_hint":false,"used_reveal":false}`,
			rewardStats: &PuzzleRewardStats{CreatorCreditsEarnedToday: 20},
			wantReason:  "creator_daily_cap_reached",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var grantCalls int
			puzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", ShareToken: "shared-token", Title: "Shared"}
			var recordedSolve *PuzzleSolveRecord
			store := &mockStore{
				getByShareFunc: func(token string) (*Puzzle, error) {
					return puzzle, nil
				},
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					if tt.existingRecord != nil {
						return tt.existingRecord, nil
					}
					if recordedSolve == nil {
						return nil, gorm.ErrRecordNotFound
					}
					return recordedSolve, nil
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
					copy := *record
					recordedSolve = &copy
					return nil
				},
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					if tt.rewardStats != nil {
						return tt.rewardStats, nil
					}
					return &PuzzleRewardStats{}, nil
				},
			}
			ledger := &mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					grantCalls++
					return &creditv1.Empty{}, nil
				},
			}

			handler := testHandlerWithStore(ledger, nil, store)
			router := testRouterWithClaims(handler, &sessionvalidator.Claims{UserID: "solver-1"})
			response := doRequest(router, "POST", "/api/shared/shared-token/complete", tt.requestBody)
			if response.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d: %s", response.Code, response.Body.String())
			}

			body := decodeJSONMap(t, response.Body.String())
			if body["reason"] != tt.wantReason {
				t.Fatalf("expected reason %q, got %v", tt.wantReason, body["reason"])
			}
			if tt.wantReason != "" && grantCalls != 0 {
				t.Fatalf("expected no creator grants for %s, got %d", tt.name, grantCalls)
			}
		})
	}
}

func TestCompletePuzzleSolve_ErrorPaths(t *testing.T) {
	ownerPuzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", Title: "Owned"}
	sharedPuzzle := &Puzzle{ID: "puzzle-1", UserID: "owner-1", Title: "Shared"}

	tests := []struct {
		name       string
		handler    *httpHandler
		puzzle     *Puzzle
		solverUser string
		req        completionRequest
		wantStatus int
	}{
		{
			name: "get solve record error",
			handler: testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, errors.New("lookup failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "existing owner record balance error",
			handler: testHandlerWithStore(&mockLedgerClient{
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return nil, errors.New("balance failed")
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return &PuzzleSolveRecord{PuzzleID: puzzleID, PuzzleOwnerUserID: solverUserID, SolverUserID: solverUserID, Source: "owner", SolverRewardCoins: 3}, nil
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "existing owner record summary error",
			handler: testHandlerWithStore(&mockLedgerClient{
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return &creditv1.BalanceResponse{TotalCents: 1000, AvailableCents: 1000}, nil
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return &PuzzleSolveRecord{PuzzleID: puzzleID, PuzzleOwnerUserID: solverUserID, SolverUserID: solverUserID, Source: "owner", SolverRewardCoins: 3}, nil
				},
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return nil, errors.New("stats failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reveal create record error",
			handler: testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
					return errors.New("create failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{UsedReveal: true},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "reveal owner balance error",
			handler: testHandlerWithStore(&mockLedgerClient{
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return nil, errors.New("balance failed")
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error { return nil },
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{UsedReveal: true},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "reveal owner summary error",
			handler: testHandlerWithStore(&mockLedgerClient{
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return &creditv1.BalanceResponse{TotalCents: 1000, AvailableCents: 1000}, nil
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error { return nil },
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return nil, errors.New("stats failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{UsedReveal: true},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "owner count error",
			handler: testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
					return 0, errors.New("count failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "owner grant error",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return nil, errors.New("grant failed")
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
					return 0, nil
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "shared stats error",
			handler: testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return nil, errors.New("stats failed")
				},
			}),
			puzzle:     sharedPuzzle,
			solverUser: "solver-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "shared reread error after lock",
			handler: func() *httpHandler {
				lookupCalls := 0
				return testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
					getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
						lookupCalls++
						if lookupCalls == 1 {
							return nil, gorm.ErrRecordNotFound
						}
						return nil, errors.New("reread failed")
					},
				})
			}(),
			puzzle:     sharedPuzzle,
			solverUser: "solver-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "shared grant error",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return nil, errors.New("grant failed")
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return &PuzzleRewardStats{}, nil
				},
			}),
			puzzle:     sharedPuzzle,
			solverUser: "solver-1",
			req:        completionRequest{},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "create record error after shared reward",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return &creditv1.Empty{}, nil
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return &PuzzleRewardStats{}, nil
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
					return errors.New("create failed")
				},
			}),
			puzzle:     sharedPuzzle,
			solverUser: "solver-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "owner create record error after reward",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return &creditv1.Empty{}, nil
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
					return 0, nil
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error {
					return errors.New("create failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
		{
			name: "owner final balance error",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return &creditv1.Empty{}, nil
				},
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return nil, errors.New("balance failed")
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
					return 0, nil
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error { return nil },
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusBadGateway,
		},
		{
			name: "owner final summary error",
			handler: testHandlerWithStore(&mockLedgerClient{
				grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
					return &creditv1.Empty{}, nil
				},
				getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
					return &creditv1.BalanceResponse{TotalCents: 1000, AvailableCents: 1000}, nil
				},
			}, nil, &mockStore{
				getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
					return nil, gorm.ErrRecordNotFound
				},
				countOwnerSolvesFunc: func(userID string, dayStart time.Time, dayEnd time.Time) (int64, error) {
					return 0, nil
				},
				createSolveRecordFunc: func(record *PuzzleSolveRecord) error { return nil },
				getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
					return nil, errors.New("stats failed")
				},
			}),
			puzzle:     ownerPuzzle,
			solverUser: "owner-1",
			req:        completionRequest{},
			wantStatus: http.StatusInternalServerError,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response, statusCode, err := tt.handler.completePuzzleSolve(context.Background(), tt.puzzle, tt.solverUser, tt.req)
			if err == nil {
				t.Fatalf("expected error for %s", tt.name)
			}
			if statusCode != tt.wantStatus {
				t.Fatalf("statusCode = %d, want %d", statusCode, tt.wantStatus)
			}
			if response != nil {
				t.Fatalf("expected nil response on error, got %#v", response)
			}
		})
	}
}

// --- helper tests ---

func TestSanitizeTopic(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"Greek gods", "Greek gods"},
		{"  padded  ", "padded"},
		{"with\x00control\x01chars", "withcontrolchars"},
		{"", ""},
		{"   ", ""},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeTopic(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeTopic(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestGetClaims_Missing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	if getClaims(ctx) != nil {
		t.Fatal("expected nil claims")
	}
}

func TestGetClaims_WrongType(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	ctx.Set("auth_claims", "not-a-claims-struct")
	if getClaims(ctx) != nil {
		t.Fatal("expected nil claims for wrong type")
	}
}

func TestClampNonNegative(t *testing.T) {
	if got := clampNonNegative(-3); got != 0 {
		t.Fatalf("clampNonNegative(-3) = %d, want 0", got)
	}
	if got := clampNonNegative(5); got != 5 {
		t.Fatalf("clampNonNegative(5) = %d, want 5", got)
	}
}

func TestCompletionResponseFromRecord_NilRecord(t *testing.T) {
	response := completionResponseFromRecord("shared", nil)
	if response == nil {
		t.Fatal("expected response")
	}
	if response.Mode != "shared" {
		t.Fatalf("expected shared mode, got %#v", response)
	}
	if response.Reason != "" {
		t.Fatalf("expected empty reason for nil record, got %#v", response)
	}
}

func TestEnsureBootstrapAndDailyGrants_GrantError(t *testing.T) {
	handler := testHandler(&mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, errors.New("grant failed")
		},
	}, nil)

	if _, err := handler.ensureBootstrapAndDailyGrants(context.Background(), "user-1"); err == nil {
		t.Fatal("expected bootstrap grant error")
	}
}

func TestEnsureBootstrapAndDailyGrants_BalanceError(t *testing.T) {
	handler := testHandler(&mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, errors.New("balance failed")
		},
	}, nil)

	if _, err := handler.ensureBootstrapAndDailyGrants(context.Background(), "user-1"); err == nil {
		t.Fatal("expected balance error")
	}
}

func TestEnsureBootstrapAndDailyGrants_DailyGrantError(t *testing.T) {
	handler := testHandler(&mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			if strings.HasPrefix(in.GetIdempotencyKey(), "daily-login:") {
				return nil, errors.New("daily grant failed")
			}
			return &creditv1.Empty{}, nil
		},
	}, nil)

	if _, err := handler.ensureBootstrapAndDailyGrants(context.Background(), "user-1"); err == nil {
		t.Fatal("expected daily-login grant error")
	}
}

func TestEnsureBootstrapAndDailyGrants_LowBalanceGrantError(t *testing.T) {
	handler := testHandler(&mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			if strings.HasPrefix(in.GetIdempotencyKey(), "low-balance:") {
				return nil, errors.New("top-up failed")
			}
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: 100, AvailableCents: 100}, nil
		},
	}, nil)
	handler.cfg.BootstrapCoins = 0
	handler.cfg.DailyLoginCoins = 0

	if _, err := handler.ensureBootstrapAndDailyGrants(context.Background(), "user-1"); err == nil {
		t.Fatal("expected low-balance grant error")
	}
}

func TestEnsureBootstrapAndDailyGrants_LowBalanceAlreadyExists(t *testing.T) {
	handler := testHandler(&mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			if strings.HasPrefix(in.GetIdempotencyKey(), "low-balance:") {
				return nil, status.Error(codes.AlreadyExists, "already granted")
			}
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{TotalCents: 100, AvailableCents: 100}, nil
		},
	}, nil)
	handler.cfg.BootstrapCoins = 0
	handler.cfg.DailyLoginCoins = 0

	grants, err := handler.ensureBootstrapAndDailyGrants(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if grants.LowBalanceCoins != 0 {
		t.Fatalf("expected no low-balance coins after already-exists, got %d", grants.LowBalanceCoins)
	}
}

func TestBuildRewardSummary_NilPuzzle(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	summary, err := handler.buildRewardSummary(nil, "user-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if summary != nil {
		t.Fatalf("expected nil summary, got %#v", summary)
	}
}

func TestBuildRewardSummary_GetSolveRecordError(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-1"}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("lookup failed")
		},
	})

	if _, err := handler.buildRewardSummary(puzzle, "user-1", time.Now().UTC()); err == nil {
		t.Fatal("expected get-solve-record error")
	}
}

func TestBuildRewardSummary_GetRewardStatsError(t *testing.T) {
	puzzle := &Puzzle{ID: "puzzle-1", UserID: "user-1"}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, gorm.ErrRecordNotFound
		},
		getRewardStatsFunc: func(puzzleID string, ownerUserID string, dayStart time.Time, dayEnd time.Time) (*PuzzleRewardStats, error) {
			return nil, errors.New("stats failed")
		},
	})

	if _, err := handler.buildRewardSummary(puzzle, "user-1", time.Now().UTC()); err == nil {
		t.Fatal("expected reward-stats error")
	}
}

func TestDecorateOwnedPuzzle_NilPuzzle(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	if err := handler.decorateOwnedPuzzle(nil, "user-1", time.Now().UTC()); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestDecorateOwnedPuzzle_Error(t *testing.T) {
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("lookup failed")
		},
	})

	if err := handler.decorateOwnedPuzzle(&Puzzle{ID: "puzzle-1", UserID: "user-1"}, "user-1", time.Now().UTC()); err == nil {
		t.Fatal("expected decorate error")
	}
}

func TestGetClaims_Valid(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(w)
	claims := testClaims()
	ctx.Set("auth_claims", claims)
	got := getClaims(ctx)
	if got == nil || got.UserID != "user-123" {
		t.Fatal("expected valid claims")
	}
}

func TestErrorResponse(t *testing.T) {
	resp := errorResponse("test_error", "something went wrong")
	if resp["error"] != "test_error" || resp["message"] != "something went wrong" {
		t.Fatalf("unexpected response: %v", resp)
	}
}

func TestMarshalMetadata(t *testing.T) {
	result := marshalMetadata(map[string]string{"key": "value"})
	if result != `{"key":"value"}` {
		t.Errorf("unexpected: %s", result)
	}
}

func TestMarshalMetadata_InvalidInput(t *testing.T) {
	// chan cannot be marshalled
	result := marshalMetadata(make(chan int))
	if result != "{}" {
		t.Errorf("expected {}, got %s", result)
	}
}

func TestIsGRPCAlreadyExists(t *testing.T) {
	if !isGRPCAlreadyExists(status.Error(codes.AlreadyExists, "dup")) {
		t.Fatal("expected true for AlreadyExists")
	}
	if isGRPCAlreadyExists(status.Error(codes.Internal, "other")) {
		t.Fatal("expected false for Internal")
	}
	if isGRPCAlreadyExists(nil) {
		t.Fatal("expected false for nil")
	}
}

func TestIsGRPCInsufficientFunds(t *testing.T) {
	if !isGRPCInsufficientFunds(status.Error(codes.FailedPrecondition, "no funds")) {
		t.Fatal("expected true for FailedPrecondition")
	}
	if isGRPCInsufficientFunds(status.Error(codes.Internal, "other")) {
		t.Fatal("expected false for Internal")
	}
}

func mustMarshalJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}

var generatedTestWords = []string{
	"ALPHA",
	"BRAVO",
	"CHARLIE",
	"DELTA",
	"ECHO",
	"FOXTROT",
	"GOLF",
	"HOTEL",
	"INDIA",
	"JULIET",
	"KILO",
	"LIMA",
	"MIKE",
	"NOVEMBER",
	"OSCAR",
}

func makeWordItems(count int) []WordItem {
	if count < 0 || count > len(generatedTestWords) {
		panic(fmt.Sprintf("unsupported test word count %d", count))
	}
	items := make([]WordItem, 0, count)
	for index := 0; index < count; index++ {
		word := generatedTestWords[index]
		items = append(items, WordItem{
			Word:       word,
			Definition: fmt.Sprintf("Definition for %s", strings.ToLower(word)),
			Hint:       fmt.Sprintf("Hint for %s", strings.ToLower(word)),
		})
	}
	return items
}

// --- Puzzle endpoint tests ---

func TestHandleListPuzzles_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	resp := doRequest(router, "GET", "/api/puzzles", "")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

func TestHandleListPuzzles_Empty(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	var body map[string][]Puzzle
	json.Unmarshal(resp.Body.Bytes(), &body)
	if len(body["puzzles"]) != 0 {
		t.Errorf("expected empty puzzles list, got %d", len(body["puzzles"]))
	}
}

func TestHandleListPuzzles_WithPuzzles(t *testing.T) {
	s := &mockStore{
		listFunc: func(userID string) ([]Puzzle, error) {
			return []Puzzle{{ID: "p1", Title: "Test", Description: "Stored detail", Words: []PuzzleWord{{Word: "HI", Clue: "Greeting", Hint: "hey"}}}}, nil
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	var body map[string][]Puzzle
	json.Unmarshal(resp.Body.Bytes(), &body)
	if len(body["puzzles"]) != 1 {
		t.Errorf("expected 1 puzzle, got %d", len(body["puzzles"]))
	}
	if body["puzzles"][0].Description != "Stored detail" {
		t.Errorf("expected description 'Stored detail', got %q", body["puzzles"][0].Description)
	}
}

func TestHandleListPuzzles_StoreError(t *testing.T) {
	s := &mockStore{
		listFunc: func(userID string) ([]Puzzle, error) {
			return nil, errors.New("db failure")
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles", "")
	if resp.Code != http.StatusInternalServerError {
		t.Errorf("expected 500, got %d", resp.Code)
	}
}

func TestHandleGetPuzzle_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	resp := doRequest(router, "GET", "/api/puzzles/some-id", "")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

func TestHandleGetPuzzle_Found(t *testing.T) {
	s := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return &Puzzle{ID: id, Title: "Found It", Description: "Stored detail"}, nil
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles/abc", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	var body Puzzle
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body.Title != "Found It" {
		t.Errorf("expected title 'Found It', got %q", body.Title)
	}
	if body.Description != "Stored detail" {
		t.Errorf("expected description 'Stored detail', got %q", body.Description)
	}
}

func TestHandleGetPuzzle_NotFound(t *testing.T) {
	s := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return nil, errors.New("not found")
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles/missing", "")
	if resp.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.Code)
	}
}

func TestHandleListPuzzles_DecorateError(t *testing.T) {
	s := &mockStore{
		listFunc: func(userID string) ([]Puzzle, error) {
			return []Puzzle{{ID: "puzzle-1", UserID: userID, Title: "Broken"}}, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("lookup failed")
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles", "")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}

func TestHandleGetPuzzle_DecorateError(t *testing.T) {
	s := &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return &Puzzle{ID: id, UserID: userID, Title: "Broken"}, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("lookup failed")
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "GET", "/api/puzzles/abc", "")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}

func TestHandleCompletePuzzle_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	resp := doRequest(router, "POST", "/api/puzzles/p1/complete", `{"used_hint":false,"used_reveal":false}`)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", resp.Code)
	}
}

func TestHandleCompletePuzzle_InvalidJSON(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/puzzles/p1/complete", `{`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}

func TestHandleCompletePuzzle_NotFound(t *testing.T) {
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return nil, errors.New("not found")
		},
	})
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/puzzles/p1/complete", `{"used_hint":false,"used_reveal":false}`)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.Code)
	}
}

func TestHandleCompletePuzzle_CompletionError(t *testing.T) {
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getFunc: func(id, userID string) (*Puzzle, error) {
			return &Puzzle{ID: id, UserID: userID, Title: "Broken"}, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("completion failed")
		},
	})
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/puzzles/p1/complete", `{"used_hint":false,"used_reveal":false}`)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}

func TestHandleCompleteSharedPuzzle_InvalidJSON(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/shared/token/complete", `{`)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.Code)
	}
}

func TestHandleCompleteSharedPuzzle_NotFound(t *testing.T) {
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return nil, errors.New("not found")
		},
	})
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/shared/token/complete", `{"used_hint":false,"used_reveal":false}`)
	if resp.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", resp.Code)
	}
}

func TestHandleCompleteSharedPuzzle_CompletionError(t *testing.T) {
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
		getByShareFunc: func(token string) (*Puzzle, error) {
			return &Puzzle{ID: "p1", UserID: "owner-1", ShareToken: token, Title: "Broken"}, nil
		},
		getSolveRecordFunc: func(puzzleID string, solverUserID string) (*PuzzleSolveRecord, error) {
			return nil, errors.New("completion failed")
		},
	})
	router := testRouterWithClaims(handler, &sessionvalidator.Claims{UserID: "solver-1"})
	resp := doRequest(router, "POST", "/api/shared/token/complete", `{"used_hint":false,"used_reveal":false}`)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", resp.Code)
	}
}

func TestHandleDeletePuzzle_NoClaims(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	resp := doRequest(router, "DELETE", "/api/puzzles/some-id", "")
	if resp.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.Code)
	}
}

func TestHandleDeletePuzzle_Success(t *testing.T) {
	deleted := false
	s := &mockStore{
		deleteFunc: func(id, userID string) error {
			deleted = true
			return nil
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "DELETE", "/api/puzzles/abc", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
	if !deleted {
		t.Error("expected delete to be called")
	}
}

func TestHandleDeletePuzzle_NotFound(t *testing.T) {
	s := &mockStore{
		deleteFunc: func(id, userID string) error {
			return errors.New("not found")
		},
	}
	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "DELETE", "/api/puzzles/missing", "")
	if resp.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.Code)
	}
}

func TestHandleGenerate_SavesPuzzle(t *testing.T) {
	var savedPuzzle *Puzzle
	s := &mockStore{
		createFunc: func(puzzle *Puzzle) error {
			puzzle.ID = "saved-id"
			savedPuzzle = puzzle
			return nil
		},
	}
	metadata := PuzzleMetadata{
		Title:       "Cat Life",
		Subtitle:    "Animal-focused answers keep the generated puzzle tight and familiar.",
		Description: "This puzzle concentrates on simple animal vocabulary and clueing that stays approachable.",
	}
	llmServer := testLLMResponseServer(t, mustMarshalJSON(makeWordItems(5)), mustMarshalJSON(metadata))
	defer llmServer.Close()

	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, req *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{AvailableCents: 1000}, nil
		},
	}
	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"cats","word_count":5}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	if savedPuzzle == nil {
		t.Fatal("expected puzzle to be saved")
	}
	if savedPuzzle.Topic != "cats" {
		t.Errorf("expected topic 'cats', got %q", savedPuzzle.Topic)
	}
	if savedPuzzle.Title != metadata.Title {
		t.Errorf("expected title %q, got %q", metadata.Title, savedPuzzle.Title)
	}
	if savedPuzzle.Subtitle != metadata.Subtitle {
		t.Errorf("expected subtitle %q, got %q", metadata.Subtitle, savedPuzzle.Subtitle)
	}
	if savedPuzzle.Description != metadata.Description {
		t.Errorf("expected description %q, got %q", metadata.Description, savedPuzzle.Description)
	}
	if len(savedPuzzle.Words) != 5 {
		t.Errorf("expected 5 words, got %d", len(savedPuzzle.Words))
	}
	var body map[string]any
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body["id"] != "saved-id" {
		t.Errorf("expected id 'saved-id' in response, got %v", body["id"])
	}
	if body["title"] != metadata.Title {
		t.Errorf("expected title %q in response, got %v", metadata.Title, body["title"])
	}
	if body["description"] != metadata.Description {
		t.Errorf("expected description %q in response, got %v", metadata.Description, body["description"])
	}
}

func TestHandleGetSharedPuzzle_Success(t *testing.T) {
	s, _ := OpenDatabase(":memory:")
	puzzle := &Puzzle{
		UserID:      "user-1",
		Title:       "Shared Test",
		Description: "Shared detail",
		Words:       []PuzzleWord{{Word: "SHARE", Clue: "Give", Hint: "distribute"}},
	}
	if err := s.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, nil) // no auth claims
	w := doRequest(router, "GET", "/api/shared/"+puzzle.ShareToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp Puzzle
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Title != "Shared Test" {
		t.Errorf("expected title 'Shared Test', got %q", resp.Title)
	}
	if resp.Description != "Shared detail" {
		t.Errorf("expected description 'Shared detail', got %q", resp.Description)
	}
	if len(resp.Words) != 1 {
		t.Errorf("expected 1 word, got %d", len(resp.Words))
	}
}

func TestHandleGetSharedPuzzle_NotFound(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "GET", "/api/shared/nonexistent", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleGetSharedPuzzle_NoAuthRequired(t *testing.T) {
	s, _ := OpenDatabase(":memory:")
	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Public",
		Words:  []PuzzleWord{{Word: "OPEN", Clue: "Not closed", Hint: "accessible"}},
	}
	s.CreatePuzzle(puzzle)

	handler := testHandlerWithStore(&mockLedgerClient{}, nil, s)
	router := testRouterWithClaims(handler, nil)
	w := doRequest(router, "GET", "/api/shared/"+puzzle.ShareToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 without auth, got %d", w.Code)
	}
}

func TestHandleGenerate_IncludesShareToken(t *testing.T) {
	ledger := &mockLedgerClient{}
	items := makeWordItems(8)
	wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	token, ok := resp["share_token"].(string)
	if !ok || token == "" {
		t.Errorf("expected non-empty share_token in generate response, got %v", resp["share_token"])
	}
}

func TestHandleGenerate_ReplaysSucceededRequestWithoutSecondSpend(t *testing.T) {
	var spendCalls int

	s, _ := OpenDatabase(":memory:")
	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			spendCalls += 1
			return &creditv1.Empty{}, nil
		},
	}
	items := makeWordItems(8)
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(llmProxyResponse{Response: mustMarshalJSON(items)})
	}))
	defer llmServer.Close()

	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	firstResponse := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("expected first response 200, got %d: %s", firstResponse.Code, firstResponse.Body.String())
	}
	secondResponse := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
	if secondResponse.Code != http.StatusOK {
		t.Fatalf("expected second response 200, got %d: %s", secondResponse.Code, secondResponse.Body.String())
	}
	if spendCalls != 1 {
		t.Fatalf("expected a single spend call, got %d", spendCalls)
	}
	var firstBody map[string]any
	var secondBody map[string]any
	if err := json.Unmarshal(firstResponse.Body.Bytes(), &firstBody); err != nil {
		t.Fatalf("Unmarshal first response: %v", err)
	}
	if err := json.Unmarshal(secondResponse.Body.Bytes(), &secondBody); err != nil {
		t.Fatalf("Unmarshal second response: %v", err)
	}
	if firstBody["id"] != secondBody["id"] {
		t.Fatalf("expected replayed id %v, got %v", firstBody["id"], secondBody["id"])
	}
	if firstBody["share_token"] != secondBody["share_token"] {
		t.Fatalf("expected replayed share_token %v, got %v", firstBody["share_token"], secondBody["share_token"])
	}
}

func TestHandleGenerate_RejectsRequestIDReuseForDifferentPayload(t *testing.T) {
	var spendCalls int

	s, _ := OpenDatabase(":memory:")
	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			spendCalls += 1
			return &creditv1.Empty{}, nil
		},
	}
	items := makeWordItems(8)
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(llmProxyResponse{Response: mustMarshalJSON(items)})
	}))
	defer llmServer.Close()

	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	firstResponse := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"test","word_count":8}`)
	if firstResponse.Code != http.StatusOK {
		t.Fatalf("expected first response 200, got %d: %s", firstResponse.Code, firstResponse.Body.String())
	}

	conflictResponse := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"different","word_count":8}`)
	if conflictResponse.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", conflictResponse.Code, conflictResponse.Body.String())
	}
	if spendCalls != 1 {
		t.Fatalf("expected a single spend call, got %d", spendCalls)
	}

	var body map[string]any
	if err := json.Unmarshal(conflictResponse.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal conflict response: %v", err)
	}
	if body["error"] != "request_id_conflict" {
		t.Fatalf("expected request_id_conflict, got %v", body["error"])
	}
}

func TestHandleGenerate_SaveFailureRefundsAndFails(t *testing.T) {
	var grantCalled bool

	s := &mockStore{
		createFunc: func(puzzle *Puzzle) error {
			return errors.New("db write failed")
		},
	}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"response": mustMarshalJSON(makeWordItems(5)),
		})
	}))
	defer llmServer.Close()

	ledger := &mockLedgerClient{
		spendFunc: func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return &creditv1.Empty{}, nil
		},
		grantFunc: func(ctx context.Context, req *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalled = true
			if req.GetIdempotencyKey() != "refund:generate_persist_failure:req-1" {
				t.Fatalf("unexpected refund idempotency key %q", req.GetIdempotencyKey())
			}
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, req *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{}, nil
		},
	}
	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"dogs","word_count":5}`)
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", resp.Code, resp.Body.String())
	}
	if !grantCalled {
		t.Fatal("expected refund grant after save failure")
	}
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if body["error"] != "puzzle_persist_failed" {
		t.Fatalf("expected puzzle_persist_failed, got %v", body["error"])
	}
}

// --- admin tests ---

func adminClaims() *sessionvalidator.Claims {
	return &sessionvalidator.Claims{
		UserID:          "admin-1",
		UserEmail:       "admin@example.com",
		UserDisplayName: "Admin User",
		UserAvatarURL:   "https://example.com/admin.png",
		UserRoles:       []string{"user"},
	}
}

func adminConfig() Config {
	cfg := testConfig()
	cfg.AdminEmails = []string{"admin@example.com"}
	return cfg
}

func TestAdminGrant_Success(t *testing.T) {
	var grantedAmount int64
	var grantedUserID string
	var grantedMetadata string
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantedAmount = in.AmountCents
			grantedUserID = in.UserId
			grantedMetadata = in.MetadataJson
			return &creditv1.Empty{}, nil
		},
	}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "POST", "/api/admin/grant", `{"user_id":"target-user","user_email":"target@example.com","amount_coins":10,"reason":"support follow-up"}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	if grantedUserID != "target-user" {
		t.Errorf("expected target-user, got %s", grantedUserID)
	}
	expectedCents := int64(10) * CoinValueCents()
	if grantedAmount != expectedCents {
		t.Errorf("expected %d cents, got %d", expectedCents, grantedAmount)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(grantedMetadata), &metadata); err != nil {
		t.Fatalf("grant metadata: %v", err)
	}
	if metadata["reason"] != "support follow-up" {
		t.Errorf("expected reason in metadata, got %v", metadata["reason"])
	}
	if metadata["target_email"] != "target@example.com" {
		t.Errorf("expected target_email in metadata, got %v", metadata["target_email"])
	}

	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["granted"] != true {
		t.Errorf("expected granted=true, got %v", body["granted"])
	}
	grant, ok := body["grant"].(map[string]any)
	if !ok {
		t.Fatalf("expected grant object, got %T", body["grant"])
	}
	if grant["reason"] != "support follow-up" {
		t.Errorf("expected response reason, got %v", grant["reason"])
	}
}

func TestAdminGrant_NonAdminForbidden(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	// Use regular (non-admin) claims.
	router := testRouterWithClaims(handler, testClaims())

	resp := doRequest(router, "POST", "/api/admin/grant", `{"user_id":"target-user","amount_coins":10,"reason":"manual grant"}`)
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrant_NoAuth(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, nil)

	resp := doRequest(router, "POST", "/api/admin/grant", `{"user_id":"target-user","amount_coins":10,"reason":"manual grant"}`)
	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrant_InvalidPayload(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	tests := []struct {
		name string
		body string
		code int
	}{
		{"missing user_id", `{"amount_coins":10,"reason":"test"}`, http.StatusBadRequest},
		{"missing amount", `{"user_id":"user-1","reason":"test"}`, http.StatusBadRequest},
		{"missing reason", `{"user_id":"user-1","amount_coins":1}`, http.StatusBadRequest},
		{"zero amount", `{"user_id":"user-1","amount_coins":0,"reason":"test"}`, http.StatusBadRequest},
		{"negative amount", `{"user_id":"user-1","amount_coins":-5,"reason":"test"}`, http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resp := doRequest(router, "POST", "/api/admin/grant", tt.body)
			if resp.Code != tt.code {
				t.Fatalf("expected %d, got %d: %s", tt.code, resp.Code, resp.Body.String())
			}
		})
	}
}

func TestAdminGrant_LedgerError(t *testing.T) {
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, status.Error(codes.Internal, "ledger down")
		},
	}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "POST", "/api/admin/grant", `{"user_id":"target-user","amount_coins":5,"reason":"manual grant"}`)
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestSessionReturnsIsAdmin(t *testing.T) {
	ledger := &mockLedgerClient{}

	// Admin user.
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())
	resp := doRequest(router, "GET", "/api/session", "")
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["is_admin"] != true {
		t.Errorf("expected is_admin=true for admin, got %v", body["is_admin"])
	}
	roles, ok := body["roles"].([]any)
	if !ok {
		t.Fatalf("expected roles array, got %T", body["roles"])
	}
	if len(roles) == 0 || roles[len(roles)-1] != "admin" {
		t.Errorf("expected admin role in session response, got %v", body["roles"])
	}

	// Regular user.
	handler2 := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router2 := testRouterWithClaims(handler2, testClaims())
	resp2 := doRequest(router2, "GET", "/api/session", "")
	var body2 map[string]any
	if err := json.Unmarshal(resp2.Body.Bytes(), &body2); err != nil {
		t.Fatal(err)
	}
	if body2["is_admin"] != false {
		t.Errorf("expected is_admin=false for regular user, got %v", body2["is_admin"])
	}
}

func TestSessionReturnsRoleBasedAdmin(t *testing.T) {
	ledger := &mockLedgerClient{}
	roleClaims := &sessionvalidator.Claims{
		UserID:          "role-admin-1",
		UserEmail:       "roleuser@example.com",
		UserDisplayName: "Role Admin",
		UserRoles:       []string{"user", "admin"},
	}
	handler := testHandlerWithConfig(ledger, nil, nil, testConfig())
	router := testRouterWithClaims(handler, roleClaims)
	resp := doRequest(router, "GET", "/api/session", "")
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["is_admin"] != true {
		t.Errorf("expected is_admin=true for role-based admin, got %v", body["is_admin"])
	}
	roles, ok := body["roles"].([]any)
	if !ok {
		t.Fatalf("expected roles array, got %T", body["roles"])
	}
	if len(roles) != 2 || roles[0] != "user" || roles[1] != "admin" {
		t.Errorf("expected original admin roles in session response, got %v", body["roles"])
	}
}

func TestAdminListUsers(t *testing.T) {
	ledger := &mockLedgerClient{}
	s := &mockStore{
		listUsersFunc: func() ([]AdminUser, error) {
			return []AdminUser{
				{UserID: "user-1", Email: "alpha@example.com"},
				{UserID: "user-2", Email: "beta@example.com"},
				{UserID: "user-3"},
			}, nil
		},
	}
	handler := testHandlerWithConfig(ledger, nil, s, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/users", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	users, ok := body["users"].([]any)
	if !ok || len(users) != 3 {
		t.Fatalf("expected 3 users, got %v", body["users"])
	}
	firstUser, ok := users[0].(map[string]any)
	if !ok {
		t.Fatalf("expected object user entry, got %T", users[0])
	}
	if firstUser["email"] != "alpha@example.com" {
		t.Fatalf("expected first email, got %v", firstUser["email"])
	}
}

func TestAdminListUsers_StoreErrorReturnsEmptyList(t *testing.T) {
	ledger := &mockLedgerClient{}
	s := &mockStore{
		listUsersFunc: func() ([]AdminUser, error) {
			return nil, errors.New("db down")
		},
	}
	handler := testHandlerWithConfig(ledger, nil, s, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/users", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	users, ok := body["users"].([]any)
	if !ok {
		t.Fatalf("expected users array, got %v", body["users"])
	}
	if len(users) != 0 {
		t.Fatalf("expected empty users list, got %v", users)
	}
}

func TestAdminListUsers_NonAdminForbidden(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, testClaims())

	resp := doRequest(router, "GET", "/api/admin/users", "")
	if resp.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminBalance(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/balance?user_id=target-user", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	balance, ok := body["balance"].(map[string]any)
	if !ok {
		t.Fatalf("expected balance object, got %v", body)
	}
	if balance["coins"] == nil {
		t.Error("expected coins field in balance")
	}
}

func TestAdminBalance_MissingUserID(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/balance", "")
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrantHistory(t *testing.T) {
	ledger := &mockLedgerClient{}
	s := &mockStore{
		listGrantRecordsFunc: func(targetUserID string, limit int) ([]AdminGrantRecord, error) {
			if targetUserID != "target-user" {
				t.Fatalf("expected target-user, got %s", targetUserID)
			}
			if limit != adminGrantHistoryLimit {
				t.Fatalf("expected limit %d, got %d", adminGrantHistoryLimit, limit)
			}
			return []AdminGrantRecord{
				{
					ID:           "grant-1",
					AdminUserID:  "admin-1",
					AdminEmail:   "admin@example.com",
					TargetUserID: "target-user",
					TargetEmail:  "target@example.com",
					AmountCoins:  5,
					Reason:       "support follow-up",
				},
			}, nil
		},
	}
	handler := testHandlerWithConfig(ledger, nil, s, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/grants?user_id=target-user", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	grants, ok := body["grants"].([]any)
	if !ok || len(grants) != 1 {
		t.Fatalf("expected 1 grant, got %v", body["grants"])
	}
	grant, ok := grants[0].(map[string]any)
	if !ok {
		t.Fatalf("expected grant object, got %T", grants[0])
	}
	if grant["reason"] != "support follow-up" {
		t.Fatalf("expected reason, got %v", grant["reason"])
	}
}

func TestAdminGrantHistory_MissingUserID(t *testing.T) {
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/grants", "")
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestHandleSession_SyncsUserProfileForAdminLookup(t *testing.T) {
	store := testStore(t)
	userHandler := testHandlerWithStore(&mockLedgerClient{}, nil, store)
	userRouter := testRouterWithClaims(userHandler, testClaims())

	resp := doRequest(userRouter, "GET", "/api/session", "")
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	adminHandler := testHandlerWithConfig(&mockLedgerClient{}, nil, store, adminConfig())
	adminRouter := testRouterWithClaims(adminHandler, adminClaims())
	adminResp := doRequest(adminRouter, "GET", "/api/admin/users", "")
	if adminResp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", adminResp.Code, adminResp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(adminResp.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	users, ok := body["users"].([]any)
	if !ok || len(users) == 0 {
		t.Fatalf("expected users, got %v", body["users"])
	}

	found := false
	for _, rawUser := range users {
		user, ok := rawUser.(map[string]any)
		if !ok {
			continue
		}
		if user["user_id"] == "user-123" && user["email"] == "user@example.com" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected synced user profile in admin list, got %v", users)
	}
}

func TestHandleGenerate_LLMError_RefundsCredits(t *testing.T) {
	var grantCalled bool
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalled = true
			if in.AmountCents != GenerateAmountCents() {
				t.Errorf("expected refund of %d cents, got %d", GenerateAmountCents(), in.AmountCents)
			}
			return &creditv1.Empty{}, nil
		},
	}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte("llm down"))
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
	if !grantCalled {
		t.Error("expected refund grant to be called after LLM failure")
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "llm_error" {
		t.Errorf("expected error code llm_error, got %v", resp["error"])
	}
}

func TestHandleGenerate_LLMTimeout_Returns504(t *testing.T) {
	ledger := &mockLedgerClient{}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusGatewayTimeout)
		w.Write([]byte("timeout"))
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"request_id":"req-1","topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "llm_timeout" {
		t.Errorf("expected error code llm_timeout, got %v", resp["error"])
	}
}

func TestRequireAdmin_AllowsRoleBasedAccess(t *testing.T) {
	// User is NOT in the admin email list but HAS the "admin" role in their TAuth claims.
	roleClaims := &sessionvalidator.Claims{
		UserID:          "role-admin-1",
		UserEmail:       "roleuser@example.com",
		UserDisplayName: "Role Admin",
		UserRoles:       []string{"user", "admin"},
	}
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, testConfig()) // no AdminEmails set
	router := testRouterWithClaims(handler, roleClaims)

	w := doRequest(router, "GET", "/api/admin/users", "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for role-based admin, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRequireAdmin_DeniesNonAdmin(t *testing.T) {
	// User has no admin email AND no admin role.
	claims := testClaims() // roles: ["user"]
	ledger := &mockLedgerClient{}
	handler := testHandlerWithConfig(ledger, nil, nil, testConfig()) // no AdminEmails
	router := testRouterWithClaims(handler, claims)

	w := doRequest(router, "GET", "/api/admin/users", "")
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
