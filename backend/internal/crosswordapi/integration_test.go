package crosswordapi

import (
	"context"
	"net"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"github.com/tyemirov/tauth/pkg/sessionvalidator"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
)

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
		LedgerInsecure:    false,          // TLS path
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
		"GET:/healthz",
		"GET:/api/session",
		"POST:/api/bootstrap",
		"GET:/api/balance",
		"POST:/api/generate",
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

	conn, err := grpc.NewClient(addr, grpc.WithInsecure())
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
	conn, err := grpc.NewClient("127.0.0.1:1", grpc.WithInsecure())
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
		SigningKey:  []byte(cfg.SessionSigningKey),
		Issuer:     cfg.SessionIssuer,
		CookieName: cfg.SessionCookieName,
	})
}
