package crosswordapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"gorm.io/gorm"
)

func TestHandleBillingSummaryCoverage(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodGet, "/api/billing/summary", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing claims, got %d", response.Code)
	}

	handler = testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
		store: &mockStore{
			getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
				return nil, errors.New("summary failed")
			},
		},
	}
	router = testRouterWithClaims(handler, testClaims())

	response = doRequest(router, http.MethodGet, "/api/billing/summary", "")
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for summary error, got %d", response.Code)
	}

	handler = testHandlerWithConfig(&mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return nil, errors.New("ledger unavailable")
		},
	}, nil, &mockStore{}, validBillingConfig())
	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: handler.ledgerClient,
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
		store:        &mockStore{},
	}
	router = testRouterWithClaims(handler, testClaims())

	response = doRequest(router, http.MethodGet, "/api/billing/summary", "")
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for balance error, got %d", response.Code)
	}
}

func TestHandleBillingCheckoutCoverage(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing claims, got %d", response.Code)
	}

	handler = testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router = testRouterWithClaims(handler, testClaims())

	response = doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when billing service is nil, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
	}
	router = testRouterWithClaims(handler, testClaims())

	response = doRequest(router, http.MethodPost, "/api/billing/checkout", `{`)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid payload, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for disabled billing service, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:        billingProviderPaddle,
			checkoutErr: ErrPaddleCheckoutURLMissing,
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for missing checkout url, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:        billingProviderPaddle,
			checkoutErr: errors.New("checkout failed"),
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for generic checkout failure, got %d", response.Code)
	}
}

func TestHandleBillingPortalCoverage(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router := testRouterWithClaims(handler, nil)

	response := doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing claims, got %d", response.Code)
	}

	handler = testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when billing service is nil, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 for disabled billing service, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
		},
		store: &mockStore{
			getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
				return nil, gorm.ErrRecordNotFound
			},
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unavailable portal, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:      billingProviderPaddle,
			portalErr: errors.New("portal failed"),
		},
		store: &mockStore{
			getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
				return &BillingCustomerLink{UserID: userID, Provider: provider, PaddleCustomerID: "ctm_123"}, nil
			},
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for portal failure, got %d", response.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:          billingProviderPaddle,
			portalSession: billingPortalSession{ProviderCode: billingProviderPaddle, URL: "https://portal.example.com"},
		},
		store: &mockStore{
			getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
				return &BillingCustomerLink{UserID: userID, Provider: provider, PaddleCustomerID: "ctm_123"}, nil
			},
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	response = doRequest(router, http.MethodPost, "/api/billing/portal", "")
	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 for portal success, got %d", response.Code)
	}
}

func TestHandleBillingWebhookCoverage(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	router := testRouterWithClaims(handler, testClaims())

	response := doRequest(router, http.MethodPost, "/api/billing/paddle/webhook", `{}`)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when billing service is nil, got %d", response.Code)
	}

	largeBody := strings.Repeat("a", 1024*1024+1)
	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
		store:        &mockStore{},
	}
	router = testRouterWithClaims(handler, testClaims())
	request := httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(largeBody))
	request.Header.Set(paddleSignatureHeaderName, "sig")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized payload, got %d", recorder.Code)
	}

	request = httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for missing signature header, got %d", recorder.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:     billingProviderPaddle,
			parseErr: errors.New("bad payload"),
		},
		store: &mockStore{},
	}
	router = testRouterWithClaims(handler, testClaims())
	request = httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(`{}`))
	request.Header.Set(paddleSignatureHeaderName, "sig")
	request.Header.Set("Content-Type", "application/json")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid webhook payload, got %d", recorder.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
			eventRecord: BillingEventRecord{
				EventID:       "evt_1",
				EventType:     paddleEventTypeTransactionUpdated,
				Provider:      billingProviderPaddle,
				TransactionID: "txn_1",
			},
		},
		store: &mockStore{
			createBillingEventRecordFunc: func(record *BillingEventRecord) error {
				return errors.New("persist failed")
			},
		},
	}
	router = testRouterWithClaims(handler, testClaims())
	request = httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(`{}`))
	request.Header.Set(paddleSignatureHeaderName, "sig")
	request.Header.Set("Content-Type", "application/json")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for webhook processing error, got %d", recorder.Code)
	}

	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
			eventRecord: BillingEventRecord{
				EventID:       "evt_2",
				EventType:     paddleEventTypeTransactionUpdated,
				Provider:      billingProviderPaddle,
				TransactionID: "txn_2",
			},
		},
		store: &mockStore{},
	}
	router = testRouterWithClaims(handler, testClaims())
	request = httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(`{}`))
	request.Header.Set(paddleSignatureHeaderName, "sig")
	request.Header.Set("Content-Type", "application/json")
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200 for webhook success, got %d", recorder.Code)
	}
}
