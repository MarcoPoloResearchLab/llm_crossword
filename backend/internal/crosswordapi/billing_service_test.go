package crosswordapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

type mockBillingProvider struct {
	checkoutSession billingCheckoutSession
	checkoutErr     error
	code            string
	customerLink    *BillingCustomerLink
	eventRecord     BillingEventRecord
	grantEvent      *BillingGrantEvent
	parseErr        error
	portalSession   billingPortalSession
	portalErr       error
	publicConfig    billingPublicConfig
	signatureErr    error
}

func (provider *mockBillingProvider) Code() string {
	if provider.code != "" {
		return provider.code
	}
	return billingProviderPaddle
}

func (provider *mockBillingProvider) PublicConfig() billingPublicConfig {
	return provider.publicConfig
}

func (provider *mockBillingProvider) SignatureHeaderName() string {
	return paddleSignatureHeaderName
}

func (provider *mockBillingProvider) VerifyWebhookSignature(signatureHeader string, payload []byte) error {
	return provider.signatureErr
}

func (provider *mockBillingProvider) ParseWebhookEvent(payload []byte) (billingProviderEvent, error) {
	if provider.parseErr != nil {
		return billingProviderEvent{}, provider.parseErr
	}
	return billingProviderEvent{
		CustomerLink: provider.customerLink,
		EventRecord:  provider.eventRecord,
		GrantEvent:   provider.grantEvent,
	}, nil
}

func (provider *mockBillingProvider) CreateCheckout(ctx context.Context, userID string, userEmail string, pack BillingPack, returnURL string) (billingCheckoutSession, error) {
	return provider.checkoutSession, provider.checkoutErr
}

func (provider *mockBillingProvider) CreatePortalSession(ctx context.Context, customerLink BillingCustomerLink) (billingPortalSession, error) {
	return provider.portalSession, provider.portalErr
}

func TestBillingServiceSummary_IncludesPortalAndActivity(t *testing.T) {
	store := &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return &BillingCustomerLink{
				UserID:           userID,
				Provider:         provider,
				PaddleCustomerID: "ctm_123",
			}, nil
		},
		listBillingEventRecordsFunc: func(userID string, provider string, limit int) ([]BillingEventRecord, error) {
			return []BillingEventRecord{
				{
					EventID:       "evt_completed",
					EventType:     paddleEventTypeTransactionCompleted,
					TransactionID: "txn_123",
					PackCode:      "starter",
					CreditsDelta:  20,
					Status:        "completed",
					OccurredAt:    time.Date(2026, time.March, 28, 18, 30, 0, 0, time.UTC),
				},
			}, nil
		},
	}
	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
		},
		store: store,
	}

	summary, err := service.Summary(context.Background(), "user-123")
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if !summary.Enabled {
		t.Fatal("expected billing summary to be enabled")
	}
	if !summary.PortalAvailable {
		t.Fatal("expected portal to be available")
	}
	if len(summary.Packs) != 1 || summary.Packs[0].Code != "starter" {
		t.Fatalf("unexpected billing packs: %#v", summary.Packs)
	}
	if len(summary.Activity) != 1 || summary.Activity[0].TransactionID != "txn_123" {
		t.Fatalf("unexpected billing activity: %#v", summary.Activity)
	}
}

func TestBillingServiceCreatePortalSession_UnavailableWithoutCustomer(t *testing.T) {
	service := &billingService{
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

	_, err := service.CreatePortalSession(context.Background(), "user-123")
	if !errors.Is(err, ErrBillingPortalUnavailable) {
		t.Fatalf("expected ErrBillingPortalUnavailable, got %v", err)
	}
}

func TestBillingServiceHandleWebhook_GrantsCreditsAndPersistsEvent(t *testing.T) {
	var createdRecord *BillingEventRecord
	var grantRequest *creditv1.GrantRequest
	var upsertedLink *BillingCustomerLink

	service := &billingService{
		cfg: validBillingConfig(),
		ledgerClient: &mockLedgerClient{
			grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				grantRequest = in
				return &creditv1.Empty{}, nil
			},
		},
		logger: zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
			customerLink: &BillingCustomerLink{
				UserID:           "user-123",
				Provider:         billingProviderPaddle,
				PaddleCustomerID: "ctm_123",
				Email:            "user@example.com",
			},
			eventRecord: BillingEventRecord{
				EventID:       "evt_123",
				EventType:     paddleEventTypeTransactionCompleted,
				Provider:      billingProviderPaddle,
				TransactionID: "txn_123",
				PackCode:      "starter",
				CreditsDelta:  20,
				Status:        "completed",
				OccurredAt:    time.Date(2026, time.March, 28, 18, 35, 0, 0, time.UTC),
			},
			grantEvent: &BillingGrantEvent{
				User:     "user-123",
				Credits:  20,
				Provider: billingProviderPaddle,
				EventID:  "evt_123",
				Metadata: map[string]string{"billing_pack_code": "starter"},
			},
		},
		store: &mockStore{
			createBillingEventRecordFunc: func(record *BillingEventRecord) error {
				copyRecord := *record
				createdRecord = &copyRecord
				return nil
			},
			upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
				copyLink := *link
				upsertedLink = &copyLink
				return nil
			},
		},
	}

	if err := service.HandleWebhook(context.Background(), "ts=1;h1=hash", []byte(`{}`)); err != nil {
		t.Fatalf("HandleWebhook() error = %v", err)
	}
	if grantRequest == nil {
		t.Fatal("expected webhook to grant credits")
	}
	if grantRequest.IdempotencyKey != "billing:paddle:evt_123" {
		t.Fatalf("unexpected idempotency key %q", grantRequest.IdempotencyKey)
	}
	if grantRequest.AmountCents != 2000 {
		t.Fatalf("unexpected grant amount cents %d", grantRequest.AmountCents)
	}
	if createdRecord == nil || createdRecord.ProcessedAt == nil {
		t.Fatalf("expected billing event record to be persisted with processed timestamp, got %#v", createdRecord)
	}
	if upsertedLink == nil || upsertedLink.PaddleCustomerID != "ctm_123" {
		t.Fatalf("expected customer link to be upserted, got %#v", upsertedLink)
	}
}

func TestHandleBillingSummaryAndCheckout(t *testing.T) {
	ledger := &mockLedgerClient{
		getBalanceFunc: func(ctx context.Context, in *creditv1.BalanceRequest, opts ...grpc.CallOption) (*creditv1.BalanceResponse, error) {
			return &creditv1.BalanceResponse{AvailableCents: 2200, TotalCents: 2200}, nil
		},
	}
	handler := testHandlerWithConfig(ledger, nil, &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return &BillingCustomerLink{UserID: userID, Provider: provider, PaddleCustomerID: "ctm_123"}, nil
		},
		listBillingEventRecordsFunc: func(userID string, provider string, limit int) ([]BillingEventRecord, error) {
			return []BillingEventRecord{
				{
					EventID:       "evt_completed",
					EventType:     paddleEventTypeTransactionCompleted,
					Provider:      provider,
					TransactionID: "txn_123",
					PackCode:      "starter",
					CreditsDelta:  20,
					Status:        "completed",
					OccurredAt:    time.Date(2026, time.March, 28, 18, 35, 0, 0, time.UTC),
				},
			}, nil
		},
	}, validBillingConfig())
	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: ledger,
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
			checkoutSession: billingCheckoutSession{
				ProviderCode:  billingProviderPaddle,
				TransactionID: "txn_123",
				CheckoutURL:   "https://example.com/pay?return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_123",
			},
		},
		store: handler.store,
	}
	router := testRouterWithClaims(handler, testClaims())

	summaryResponse := doRequest(router, http.MethodGet, "/api/billing/summary", "")
	if summaryResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from billing summary, got %d", summaryResponse.Code)
	}

	payload := decodeJSONMap(t, summaryResponse.Body.String())
	if payload["provider_code"] != billingProviderPaddle {
		t.Fatalf("unexpected summary payload: %#v", payload)
	}

	checkoutResponse := doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"starter"}`)
	if checkoutResponse.Code != http.StatusOK {
		t.Fatalf("expected 200 from billing checkout, got %d", checkoutResponse.Code)
	}

	checkoutPayload := decodeJSONMap(t, checkoutResponse.Body.String())
	if checkoutPayload["transaction_id"] != "txn_123" {
		t.Fatalf("unexpected checkout payload: %#v", checkoutPayload)
	}
	if checkoutPayload["checkout_url"] != "https://example.com/pay?return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_123" {
		t.Fatalf("unexpected checkout payload: %#v", checkoutPayload)
	}

	invalidCheckoutResponse := doRequest(router, http.MethodPost, "/api/billing/checkout", `{"pack_id":"missing"}`)
	if invalidCheckoutResponse.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 from invalid billing checkout, got %d", invalidCheckoutResponse.Code)
	}
}

func TestHandleBillingWebhookInvalidSignature(t *testing.T) {
	handler := testHandlerWithConfig(&mockLedgerClient{}, nil, &mockStore{}, validBillingConfig())
	handler.billingService = &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:         billingProviderPaddle,
			signatureErr: status.Error(codes.Unauthenticated, "invalid signature"),
		},
		store: handler.store,
	}
	router := testRouterWithClaims(handler, testClaims())

	request := httptest.NewRequest(http.MethodPost, "/api/billing/paddle/webhook", strings.NewReader(`{}`))
	request.Header.Set(paddleSignatureHeaderName, "invalid")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 from billing webhook invalid signature, got %d", recorder.Code)
	}
}
