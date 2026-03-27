package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/gin-gonic/gin"
	"github.com/tyemirov/tauth/pkg/sessionvalidator"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
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
	logger, _ := zap.NewDevelopment()
	cfg := testConfig()
	if llmServer != nil {
		cfg.LLMProxyURL = llmServer.URL
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
	router.GET("/api/session", handler.handleSession)
	router.POST("/api/bootstrap", handler.handleBootstrap)
	router.GET("/api/balance", handler.handleBalance)
	router.POST("/api/generate", handler.handleGenerate)
	router.GET("/api/puzzles", handler.handleListPuzzles)
	router.GET("/api/puzzles/:id", handler.handleGetPuzzle)
	router.DELETE("/api/puzzles/:id", handler.handleDeletePuzzle)
	router.GET("/api/shared/:token", handler.handleGetSharedPuzzle)

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
	var reader *strings.Reader
	if body != "" {
		reader = strings.NewReader(body)
	} else {
		reader = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"test"}`)
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

func TestHandleGenerate_EmptyTopic(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"topic":"","word_count":8}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleGenerate_TopicTooLong(t *testing.T) {
	handler := testHandler(&mockLedgerClient{}, nil)
	router := testRouterWithClaims(handler, testClaims())
	longTopic := strings.Repeat("a", 201)
	body := fmt.Sprintf(`{"topic":%q,"word_count":8}`, longTopic)
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", w.Code)
	}
}

func TestHandleGenerate_Success(t *testing.T) {
	ledger := &mockLedgerClient{}
	items := []WordItem{
		{Word: "ZEUS", Definition: "King of gods", Hint: "Lightning thrower"},
		{Word: "HERA", Definition: "Queen of gods", Hint: "Wife of Zeus"},
	}
	wrapper := llmProxyResponse{
		Request:  "test",
		Response: mustMarshalJSON(items),
	}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	respItems, ok := resp["items"].([]any)
	if !ok || len(respItems) != 2 {
		t.Fatalf("expected 2 items, got %v", resp["items"])
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
			items := []WordItem{
				{Word: "TEST", Definition: "A test word", Hint: "Testing"},
			}
			wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
			llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(wrapper)
			}))
			defer llmServer.Close()

			handler := testHandler(ledger, llmServer)
			router := testRouterWithClaims(handler, testClaims())
			body := fmt.Sprintf(`{"topic":"test","word_count":%d}`, tt.wordCount)
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
	items := []WordItem{
		{Word: "TEST", Definition: "A test word", Hint: "Testing"},
	}
	wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"topic":"test","word_count":8}`)
	// Should still succeed even if balance fetch fails.
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
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
			return []Puzzle{{ID: "p1", Title: "Test", Words: []PuzzleWord{{Word: "HI", Clue: "Greeting", Hint: "hey"}}}}, nil
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
			return &Puzzle{ID: id, Title: "Found It"}, nil
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
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"response": `[{"word":"CAT","definition":"Animal","hint":"meow"}]`,
		})
	}))
	defer llmServer.Close()

	ledger := &mockLedgerClient{
		spendFunc:      func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) { return &creditv1.Empty{}, nil },
		getBalanceFunc: func(ctx context.Context, req *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) { return &creditv1.BalanceResponse{AvailableCents: 1000}, nil },
	}
	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"topic":"cats","word_count":5}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}
	if savedPuzzle == nil {
		t.Fatal("expected puzzle to be saved")
	}
	if savedPuzzle.Topic != "cats" {
		t.Errorf("expected topic 'cats', got %q", savedPuzzle.Topic)
	}
	if len(savedPuzzle.Words) != 1 {
		t.Errorf("expected 1 word, got %d", len(savedPuzzle.Words))
	}
	var body map[string]any
	json.Unmarshal(resp.Body.Bytes(), &body)
	if body["id"] != "saved-id" {
		t.Errorf("expected id 'saved-id' in response, got %v", body["id"])
	}
}

func TestHandleGetSharedPuzzle_Success(t *testing.T) {
	s, _ := OpenDatabase(":memory:")
	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Shared Test",
		Words:  []PuzzleWord{{Word: "SHARE", Clue: "Give", Hint: "distribute"}},
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
	items := []WordItem{
		{Word: "TEST", Definition: "A trial", Hint: "Exam"},
	}
	wrapper := llmProxyResponse{Response: mustMarshalJSON(items)}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(wrapper)
	}))
	defer llmServer.Close()

	handler := testHandler(ledger, llmServer)
	router := testRouterWithClaims(handler, testClaims())
	w := doRequest(router, "POST", "/api/generate", `{"topic":"test","word_count":8}`)
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

func TestHandleGenerate_SaveFailureIsNonFatal(t *testing.T) {
	s := &mockStore{
		createFunc: func(puzzle *Puzzle) error {
			return errors.New("db write failed")
		},
	}
	llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{
			"response": `[{"word":"DOG","definition":"Animal","hint":"bark"}]`,
		})
	}))
	defer llmServer.Close()

	ledger := &mockLedgerClient{
		spendFunc:      func(ctx context.Context, req *creditv1.SpendRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) { return &creditv1.Empty{}, nil },
		getBalanceFunc: func(ctx context.Context, req *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) { return &creditv1.BalanceResponse{}, nil },
	}
	handler := testHandlerWithStore(ledger, llmServer, s)
	router := testRouterWithClaims(handler, testClaims())
	resp := doRequest(router, "POST", "/api/generate", `{"topic":"dogs","word_count":5}`)
	// Should still return 200 even though save failed.
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200 (save failure is non-fatal), got %d: %s", resp.Code, resp.Body.String())
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
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
	w := doRequest(router, "POST", "/api/generate", `{"topic":"Greek gods","word_count":8}`)
	if w.Code != http.StatusGatewayTimeout {
		t.Fatalf("expected 504, got %d: %s", w.Code, w.Body.String())
	}
	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["error"] != "llm_timeout" {
		t.Errorf("expected error code llm_timeout, got %v", resp["error"])
	}
}
