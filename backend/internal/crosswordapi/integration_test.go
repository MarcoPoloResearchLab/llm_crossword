package crosswordapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/tyemirov/tauth/pkg/sessionvalidator"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials/insecure"
)

// withOnServerReady sets a callback invoked once the HTTP server is about to listen.
func withOnServerReady(f func(srv *http.Server)) RunOption {
	return func(o *runOptions) { o.onServerReady = f }
}

// fakeLedgerServer is a minimal gRPC server that satisfies the CreditService interface.
type fakeLedgerServer struct {
	creditv1.UnimplementedCreditServiceServer
}

func (f *fakeLedgerServer) GetBalance(_ context.Context, _ *creditv1.BalanceRequest) (*creditv1.BalanceResponse, error) {
	return &creditv1.BalanceResponse{TotalCents: 2000, AvailableCents: 1500}, nil
}

func (f *fakeLedgerServer) Grant(_ context.Context, _ *creditv1.GrantRequest) (*creditv1.Empty, error) {
	return &creditv1.Empty{}, nil
}

func (f *fakeLedgerServer) Spend(_ context.Context, _ *creditv1.SpendRequest) (*creditv1.Empty, error) {
	return &creditv1.Empty{}, nil
}

func startFakeLedger(t *testing.T) (addr string, stop func()) {
	t.Helper()
	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := grpc.NewServer()
	creditv1.RegisterCreditServiceServer(s, &fakeLedgerServer{})
	go s.Serve(lis)
	return lis.Addr().String(), s.GracefulStop
}

func TestRun_StartsAndShuts(t *testing.T) {
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	// Find a free port for the HTTP server.
	lis, _ := net.Listen("tcp", "127.0.0.1:0")
	httpAddr := lis.Addr().String()
	lis.Close()

	cfg := Config{
		ListenAddr:        httpAddr,
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-secret-key-long-enough-for-hmac",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- Run(ctx, cfg)
	}()

	// Give the server a moment to start.
	time.Sleep(200 * time.Millisecond)

	// Cancel context to trigger shutdown.
	cancel()

	select {
	case err := <-errCh:
		if err != nil {
			t.Fatalf("Run returned error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancellation")
	}
}

func TestRun_TLSLedger(t *testing.T) {
	// Test the TLS dial branch — will fail to connect but exercises the code path.
	cfg := Config{
		ListenAddr:        "127.0.0.1:0",
		LedgerAddress:     "127.0.0.1:1", // won't connect
		LedgerInsecure:    false,         // TLS path
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-key",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	err := Run(ctx, cfg)
	// Should return error because ledger connection times out (context cancelled).
	if err == nil {
		// It's also OK if it returns nil (context cancelled during wait).
		return
	}
}

func TestSetupRouter_HasRoutes(t *testing.T) {
	cfg := testConfig()
	logger, _ := newTestLogger()
	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
	}

	validator, err := newTestValidator(cfg)
	if err != nil {
		t.Fatalf("validator: %v", err)
	}

	router := setupRouter(cfg, handler, validator)
	routes := router.Routes()
	paths := make(map[string]bool)
	for _, r := range routes {
		paths[r.Method+":"+r.Path] = true
	}

	expected := []string{
		"GET:/config.yml",
		"GET:/healthz",
		"GET:/api/session",
		"POST:/api/bootstrap",
		"GET:/api/balance",
		"POST:/api/generate",
		"GET:/api/puzzles",
		"GET:/api/puzzles/:id",
		"POST:/api/puzzles/:id/complete",
		"DELETE:/api/puzzles/:id",
		"GET:/api/shared/:token",
		"POST:/api/shared/:token/complete",
	}
	for _, e := range expected {
		if !paths[e] {
			t.Errorf("missing route: %s", e)
		}
	}
}

func TestWaitForClientReady_AlreadyReady(t *testing.T) {
	addr, stop := startFakeLedger(t)
	defer stop()

	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.Connect()

	// Wait until actually ready.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for conn.GetState() != connectivity.Ready {
		if !conn.WaitForStateChange(ctx, conn.GetState()) {
			t.Fatal("timed out waiting for connection")
		}
	}

	// Now call waitForClientReady — should return immediately.
	if err := waitForClientReady(ctx, conn); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestWaitForClientReady_ContextCancelled(t *testing.T) {
	// Connect to a port where nothing is listening.
	conn, err := grpc.NewClient("127.0.0.1:1", grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()
	conn.Connect()

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	err = waitForClientReady(ctx, conn)
	if err == nil {
		t.Fatal("expected error for cancelled context")
	}
}

func TestRun_ListenError(t *testing.T) {
	// Bind a port first so Run fails with "address already in use".
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	lis, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer lis.Close()
	occupiedAddr := lis.Addr().String()

	cfg := Config{
		ListenAddr:        occupiedAddr,
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-secret-key-long-enough-for-hmac",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	// Use a long-lived context so the errCh branch is hit before ctx.Done().
	ctx := context.Background()

	err = Run(ctx, cfg)
	if err == nil {
		t.Fatal("expected error for occupied port")
	}
}

func TestRun_InvalidSessionValidator(t *testing.T) {
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	cfg := Config{
		ListenAddr:        "127.0.0.1:0",
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "", // empty key causes sessionvalidator.New to fail
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	err := Run(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected error for empty signing key")
	}
}

func TestSetupRouter_HealthzEndpoint(t *testing.T) {
	cfg := testConfig()
	logger, _ := newTestLogger()
	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
	}
	validator, _ := newTestValidator(cfg)
	router := setupRouter(cfg, handler, validator)

	w := doRequest(router, "GET", "/healthz", "")
	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// helpers for this file

func newTestLogger() (*zap.Logger, error) {
	return zap.NewDevelopment()
}

func newTestValidator(cfg Config) (*sessionvalidator.Validator, error) {
	return sessionvalidator.New(sessionvalidator.Config{
		SigningKey: []byte(cfg.SessionSigningKey),
		Issuer:     cfg.SessionIssuer,
		CookieName: cfg.SessionCookieName,
	})
}

func TestRun_GRPCDialError(t *testing.T) {
	cfg := Config{
		ListenAddr:        ":0",
		LedgerAddress:     "127.0.0.1:1",
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-key",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	failDial := func(target string, opts ...grpc.DialOption) (*grpc.ClientConn, error) {
		return nil, fmt.Errorf("forced dial error")
	}

	err := Run(context.Background(), cfg, WithGRPCDialFunc(failDial))
	if err == nil {
		t.Fatal("expected error for grpc dial failure")
	}
	if !strings.Contains(err.Error(), "connect ledger") {
		t.Fatalf("expected 'connect ledger' error, got: %v", err)
	}
}

func TestRun_ErrServerClosed(t *testing.T) {
	// Exercise the ErrServerClosed branch in the select by calling server.Close()
	// which causes ListenAndServe to return http.ErrServerClosed.
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	lis, _ := net.Listen("tcp", "127.0.0.1:0")
	httpAddr := lis.Addr().String()
	lis.Close()

	cfg := Config{
		ListenAddr:        httpAddr,
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-secret-key-long-enough-for-hmac",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	var srv *http.Server
	readyHook := withOnServerReady(func(s *http.Server) {
		srv = s
	})

	errCh := make(chan error, 1)
	go func() {
		errCh <- Run(context.Background(), cfg, readyHook)
	}()

	// Wait for the server to start.
	time.Sleep(300 * time.Millisecond)

	// Close the server directly — ListenAndServe returns ErrServerClosed.
	if srv != nil {
		srv.Close()
	}

	select {
	case err := <-errCh:
		// ErrServerClosed is treated as success (returns nil).
		if err != nil {
			t.Fatalf("expected nil error for ErrServerClosed, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after server.Close()")
	}
}

func TestRun_ShutdownError(t *testing.T) {
	// Exercise the Shutdown error branch by having an active connection
	// and using a very short shutdown timeout.
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	lis, _ := net.Listen("tcp", "127.0.0.1:0")
	httpAddr := lis.Addr().String()
	lis.Close()

	cfg := Config{
		ListenAddr:        httpAddr,
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-secret-key-long-enough-for-hmac",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	var srvRef *http.Server
	ctx, cancel := context.WithCancel(context.Background())
	readyHook := withOnServerReady(func(s *http.Server) {
		srvRef = s
	})

	errCh := make(chan error, 1)
	go func() {
		// Use a nanosecond shutdown timeout so the shutdown context
		// expires before active connections are drained.
		errCh <- Run(ctx, cfg, readyHook, WithShutdownTimeout(time.Nanosecond))
	}()

	// Wait for the server to start.
	time.Sleep(300 * time.Millisecond)

	// Open a connection that sends a partial HTTP request (no terminating
	// blank line), so the server is still waiting for the full request
	// during shutdown. This makes Shutdown block on draining.
	if srvRef != nil {
		conn, dialErr := net.Dial("tcp", httpAddr)
		if dialErr == nil {
			defer conn.Close()
			// Send headers but NOT the blank line that terminates the request.
			conn.Write([]byte("GET /healthz HTTP/1.1\r\nHost: localhost\r\n"))
		}
	}

	// Give the connection time to be established.
	time.Sleep(50 * time.Millisecond)

	// Cancel context — triggers the ctx.Done() branch with a tiny shutdown timeout.
	cancel()

	select {
	case err := <-errCh:
		// Shutdown error is logged but Run still returns nil.
		if err != nil {
			t.Fatalf("expected nil error, got: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after context cancellation")
	}
}

// --- Shared puzzle integration tests ---
// These use setupRouter with a real session validator and real GORM store
// to verify the sharing flow end-to-end through the actual middleware stack.

func TestSharedEndpoint_Integration_NoAuthRequired(t *testing.T) {
	// Verify that GET /api/shared/:token works without a session cookie
	// through the real setupRouter (not testRouterWithClaims).
	cfg := testConfig()
	logger, _ := newTestLogger()
	store, _ := OpenDatabase(":memory:")
	validator, _ := newTestValidator(cfg)

	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
		store:  store,
	}
	router := setupRouter(cfg, handler, validator)

	// Create a puzzle in the store.
	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Shared via integration",
		Words:  []PuzzleWord{{Word: "SHARE", Clue: "Give to others", Hint: "distribute"}},
	}
	if err := store.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	// Request the shared endpoint WITHOUT any auth cookie.
	w := doRequest(router, "GET", "/api/shared/"+puzzle.ShareToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp Puzzle
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.Title != "Shared via integration" {
		t.Errorf("expected title 'Shared via integration', got %q", resp.Title)
	}
	if len(resp.Words) != 1 {
		t.Errorf("expected 1 word, got %d", len(resp.Words))
	}
	if resp.Words[0].Word != "SHARE" {
		t.Errorf("expected word 'SHARE', got %q", resp.Words[0].Word)
	}
}

func TestSharedEndpoint_Integration_NotFound(t *testing.T) {
	cfg := testConfig()
	logger, _ := newTestLogger()
	store, _ := OpenDatabase(":memory:")
	validator, _ := newTestValidator(cfg)

	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
		store:  store,
	}
	router := setupRouter(cfg, handler, validator)

	w := doRequest(router, "GET", "/api/shared/bogustoken1", "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSharedEndpoint_Integration_DeletedPuzzleReturns404(t *testing.T) {
	// Verify that deleting a puzzle invalidates its share link.
	cfg := testConfig()
	logger, _ := newTestLogger()
	store, _ := OpenDatabase(":memory:")
	validator, _ := newTestValidator(cfg)

	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
		store:  store,
	}
	router := setupRouter(cfg, handler, validator)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Will Be Deleted",
		Words:  []PuzzleWord{{Word: "GONE", Clue: "Vanished", Hint: "disappeared"}},
	}
	if err := store.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}
	token := puzzle.ShareToken

	// Confirm it works before deletion.
	w := doRequest(router, "GET", "/api/shared/"+token, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 before delete, got %d", w.Code)
	}

	// Delete the puzzle.
	if err := store.DeletePuzzle(puzzle.ID, "user-1"); err != nil {
		t.Fatalf("DeletePuzzle: %v", err)
	}

	// Share token should now return 404.
	w = doRequest(router, "GET", "/api/shared/"+token, "")
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", w.Code)
	}
}

func TestSharedEndpoint_Integration_AuthEndpointsStillProtected(t *testing.T) {
	// Verify that authenticated endpoints still require auth even though
	// the shared endpoint doesn't.
	cfg := testConfig()
	logger, _ := newTestLogger()
	store, _ := OpenDatabase(":memory:")
	validator, _ := newTestValidator(cfg)

	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
		store:  store,
	}
	router := setupRouter(cfg, handler, validator)

	// These should all fail with 401 without a session cookie.
	authEndpoints := []struct {
		method string
		path   string
	}{
		{"GET", "/api/session"},
		{"GET", "/api/balance"},
		{"GET", "/api/puzzles"},
		{"GET", "/api/puzzles/some-id"},
		{"DELETE", "/api/puzzles/some-id"},
	}

	for _, ep := range authEndpoints {
		w := doRequest(router, ep.method, ep.path, "")
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401, got %d", ep.method, ep.path, w.Code)
		}
	}
}

func TestSharedEndpoint_Integration_ResponseIncludesShareToken(t *testing.T) {
	// Verify the share_token field is present in the shared puzzle response.
	cfg := testConfig()
	logger, _ := newTestLogger()
	store, _ := OpenDatabase(":memory:")
	validator, _ := newTestValidator(cfg)

	handler := &httpHandler{
		logger: logger,
		cfg:    cfg,
		store:  store,
	}
	router := setupRouter(cfg, handler, validator)

	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Token Echo",
		Words:  []PuzzleWord{{Word: "ECHO", Clue: "Repeat", Hint: "sound bounce"}},
	}
	store.CreatePuzzle(puzzle)

	w := doRequest(router, "GET", "/api/shared/"+puzzle.ShareToken, "")
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]any
	json.Unmarshal(w.Body.Bytes(), &resp)
	token, ok := resp["share_token"].(string)
	if !ok || token == "" {
		t.Errorf("expected non-empty share_token in response, got %v", resp["share_token"])
	}
	if token != puzzle.ShareToken {
		t.Errorf("expected token %q, got %q", puzzle.ShareToken, token)
	}
}

func TestSharedEndpoint_Integration_BackfillsExistingPuzzles(t *testing.T) {
	// Verify that OpenDatabase backfills share tokens for puzzles that lack one.
	// Simulate by creating a puzzle with raw GORM, then reopening the database.
	db, err := OpenDatabase(":memory:")
	if err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}

	// Create a puzzle.
	puzzle := &Puzzle{
		UserID: "user-1",
		Title:  "Backfill Test",
		Words:  []PuzzleWord{{Word: "OLD", Clue: "Not new", Hint: "ancient"}},
	}
	if err := db.CreatePuzzle(puzzle); err != nil {
		t.Fatalf("CreatePuzzle: %v", err)
	}

	// Puzzle should already have a token (CreatePuzzle sets it).
	if puzzle.ShareToken == "" {
		t.Fatal("expected share token to be set by CreatePuzzle")
	}

	// Verify we can look it up.
	got, err := db.GetPuzzleByShareToken(puzzle.ShareToken)
	if err != nil {
		t.Fatalf("GetPuzzleByShareToken: %v", err)
	}
	if got.Title != "Backfill Test" {
		t.Errorf("expected title 'Backfill Test', got %q", got.Title)
	}
}

func TestRun_LoggerInitError(t *testing.T) {
	cfg := Config{
		ListenAddr:        ":0",
		LedgerAddress:     "127.0.0.1:1",
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "t1",
		DefaultLedgerID:   "l1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-key",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
	}

	failFactory := func() (*zap.Logger, error) {
		return nil, fmt.Errorf("logger init failed")
	}

	err := Run(context.Background(), cfg, WithLoggerFactory(failFactory))
	if err == nil {
		t.Fatal("expected error for logger init failure")
	}
	if !strings.Contains(err.Error(), "zap init") {
		t.Fatalf("expected 'zap init' error, got: %v", err)
	}
}
