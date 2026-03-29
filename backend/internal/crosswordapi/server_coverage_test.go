package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"google.golang.org/grpc"
)

func TestWithStore_SetsStore(t *testing.T) {
	options := runOptions{}
	store := &mockStore{}

	WithStore(store)(&options)

	if options.store != store {
		t.Fatal("expected store option to be set")
	}
}

func TestRun_UsesInjectedStore(t *testing.T) {
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	httpAddr := listener.Addr().String()
	listener.Close()

	cfg := Config{
		ListenAddr:        httpAddr,
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "tenant-1",
		DefaultLedgerID:   "ledger-1",
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
	defer cancel()

	errCh := make(chan error, 1)
	go func() {
		errCh <- Run(ctx, cfg, WithStore(&mockStore{}))
	}()

	time.Sleep(200 * time.Millisecond)
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

func TestRun_DatabaseOpenError(t *testing.T) {
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	cfg := Config{
		ListenAddr:        "127.0.0.1:0",
		LedgerAddress:     addr,
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		DefaultTenantID:   "tenant-1",
		DefaultLedgerID:   "ledger-1",
		AllowedOrigins:    []string{"http://localhost"},
		SessionSigningKey: "test-secret-key-long-enough-for-hmac",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "key",
		LLMProxyTimeout:   5 * time.Second,
		DatabaseDSN:       t.TempDir(),
	}

	err := Run(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected database open error")
	}
}

func TestRun_BillingInitError(t *testing.T) {
	addr, stopLedger := startFakeLedger(t)
	defer stopLedger()

	cfg := validBillingConfig()
	cfg.ListenAddr = "127.0.0.1:0"
	cfg.LedgerAddress = addr
	cfg.LedgerInsecure = true
	cfg.PaddleAPIKey = ""

	err := Run(context.Background(), cfg, WithStore(&mockStore{}))
	if err == nil {
		t.Fatal("expected billing init error")
	}
	if !strings.Contains(err.Error(), "billing init") {
		t.Fatalf("expected billing init error, got %v", err)
	}
}

func TestGeneratePuzzleMetadata_ReturnsLastError(t *testing.T) {
	llmServer := testLLMResponseServer(t, `{"title":1}`, `{"title":2}`)
	defer llmServer.Close()

	handler := testHandler(&mockLedgerClient{}, llmServer)
	_, err := handler.generatePuzzleMetadata(context.Background(), "Roman city", []WordItem{
		{Word: "FORUM", Definition: "Public square", Hint: "civic center"},
	})
	if err == nil {
		t.Fatal("expected metadata error")
	}
}

func TestRefundCredits_GrantError(t *testing.T) {
	grantCalls := 0
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantCalls += 1
			return nil, errors.New("grant failed")
		},
	}

	handler := testHandler(ledger, nil)
	handler.refundCredits(context.Background(), "user-1", GenerateAmountCents(), "generation_failure")

	if grantCalls != 1 {
		t.Fatalf("expected 1 grant call, got %d", grantCalls)
	}
}

func TestAdminBalance_LedgerError(t *testing.T) {
	ledger := &mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, errors.New("balance unavailable")
		},
	}
	handler := testHandlerWithConfig(ledger, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/balance?user_id=target-user", "")
	if resp.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrantHistory_StoreError(t *testing.T) {
	s := &mockStore{
		listGrantRecordsFunc: func(targetUserID string, limit int) ([]AdminGrantRecord, error) {
			return nil, errors.New("db down")
		},
	}
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, s, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "GET", "/api/admin/grants?user_id=target-user", "")
	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrant_ReasonTooLong(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())
	body := `{"user_id":"target-user","amount_coins":5,"reason":"` + strings.Repeat("a", adminGrantReasonMaxLen+1) + `"}`

	resp := doRequest(router, "POST", "/api/admin/grant", body)
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrant_InvalidJSON(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, nil, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "POST", "/api/admin/grant", "{")
	if resp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", resp.Code, resp.Body.String())
	}
}

func TestAdminGrant_RecordSaveFailureAndBalanceFetchFailure(t *testing.T) {
	ledger := &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return &creditv1.Empty{}, nil
		},
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, errors.New("balance unavailable")
		},
	}
	s := &mockStore{
		createGrantRecordFunc: func(record *AdminGrantRecord) error {
			return errors.New("write failed")
		},
	}
	handler := testHandlerWithConfig(ledger, nil, s, adminConfig())
	router := testRouterWithClaims(handler, adminClaims())

	resp := doRequest(router, "POST", "/api/admin/grant", `{"user_id":"target-user","user_email":"target@example.com","amount_coins":5,"reason":"support follow-up"}`)
	if resp.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.Code, resp.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(resp.Body.Bytes(), &body); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if body["granted"] != true {
		t.Fatalf("expected granted=true, got %v", body["granted"])
	}
	if balance, exists := body["balance"]; exists && balance != nil {
		t.Fatalf("expected no balance payload, got %v", balance)
	}
	if grant, exists := body["grant"]; !exists || grant != nil {
		t.Fatalf("expected null grant payload, got %v", grant)
	}
}

func TestSyncUserProfile_GuardsAndErrors(t *testing.T) {
	t.Run("nil claims", func(t *testing.T) {
		callCount := 0
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			upsertUserProfileFunc: func(profile *UserProfile) error {
				callCount += 1
				return nil
			},
		})

		handler.syncUserProfile(nil)

		if callCount != 0 {
			t.Fatalf("expected no upsert, got %d calls", callCount)
		}
	})

	t.Run("nil store", func(t *testing.T) {
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, nil)
		handler.store = nil
		handler.syncUserProfile(testClaims())
	})

	t.Run("store error", func(t *testing.T) {
		callCount := 0
		handler := testHandlerWithStore(&mockLedgerClient{}, nil, &mockStore{
			upsertUserProfileFunc: func(profile *UserProfile) error {
				callCount += 1
				return errors.New("write failed")
			},
		})

		handler.syncUserProfile(testClaims())

		if callCount != 1 {
			t.Fatalf("expected 1 upsert, got %d", callCount)
		}
	})
}
