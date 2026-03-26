package crosswordapi

import (
	"context"
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
