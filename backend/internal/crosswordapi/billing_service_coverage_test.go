package crosswordapi

import (
	"context"
	"crypto/tls"
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

func TestNewBillingServiceCoverage(t *testing.T) {
	cfg := validConfig()

	service, err := newBillingService(cfg, &mockLedgerClient{}, &mockStore{}, zap.NewNop())
	if err != nil {
		t.Fatalf("newBillingService(disabled) error = %v", err)
	}
	if service != nil {
		t.Fatalf("expected nil billing service when billing is disabled, got %#v", service)
	}

	cfg = validBillingConfig()
	cfg.BillingProvider = "stripe"
	if _, err := newBillingService(cfg, &mockLedgerClient{}, &mockStore{}, zap.NewNop()); err == nil {
		t.Fatal("expected unsupported provider error")
	}

	cfg = validBillingConfig()
	cfg.PaddleAPIKey = ""
	if _, err := newBillingService(cfg, &mockLedgerClient{}, &mockStore{}, zap.NewNop()); err == nil {
		t.Fatal("expected paddle provider init error")
	}

	cfg = validBillingConfig()
	service, err = newBillingService(cfg, &mockLedgerClient{}, &mockStore{}, zap.NewNop())
	if err != nil {
		t.Fatalf("newBillingService(enabled) error = %v", err)
	}
	if service == nil || service.provider == nil {
		t.Fatalf("expected billing service with provider, got %#v", service)
	}
}

func TestBillingServiceSummaryCoverage(t *testing.T) {
	summary, err := (*billingService)(nil).Summary(context.Background(), "user-123")
	if err != nil {
		t.Fatalf("nil Summary() error = %v", err)
	}
	if summary.Enabled || len(summary.Packs) != 0 || len(summary.Activity) != 0 {
		t.Fatalf("unexpected nil summary payload %#v", summary)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
		store: &mockStore{
			getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
				return nil, errors.New("customer link lookup failed")
			},
		},
	}
	if _, err := service.Summary(context.Background(), "user-123"); err == nil || !strings.Contains(err.Error(), "customer link lookup failed") {
		t.Fatalf("expected summary to return customer link error, got %v", err)
	}

	service.store = &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return nil, gorm.ErrRecordNotFound
		},
		listBillingEventRecordsFunc: func(userID string, provider string, limit int) ([]BillingEventRecord, error) {
			return nil, errors.New("activity lookup failed")
		},
	}
	if _, err := service.Summary(context.Background(), "user-123"); err == nil || !strings.Contains(err.Error(), "activity lookup failed") {
		t.Fatalf("expected summary to return activity error, got %v", err)
	}
}

func TestBillingActivityHelpersCoverage(t *testing.T) {
	processedAt := time.Date(2026, time.March, 29, 13, 0, 0, 0, time.UTC)
	entries := mapBillingActivity([]BillingEventRecord{
		{
			EventID:       "evt_completed",
			EventType:     paddleEventTypeTransactionCompleted,
			TransactionID: "txn_123",
			PackCode:      "starter",
			CreditsDelta:  20,
			Status:        "completed",
			OccurredAt:    time.Date(2026, time.March, 29, 12, 0, 0, 0, time.UTC),
			ProcessedAt:   &processedAt,
		},
		{
			EventID:       "evt_other",
			EventType:     "something.else",
			TransactionID: "txn_456",
			Status:        "open",
		},
	})
	if len(entries) != 2 {
		t.Fatalf("unexpected billing activity entries %#v", entries)
	}
	if entries[0].OccurredAt == "" || entries[0].ProcessedAt == "" {
		t.Fatalf("expected timestamps to be formatted, got %#v", entries[0])
	}
	if entries[1].OccurredAt != "" || entries[1].ProcessedAt != "" {
		t.Fatalf("expected zero timestamps to stay empty, got %#v", entries[1])
	}

	testCases := []struct {
		name     string
		record   BillingEventRecord
		expected string
	}{
		{
			name: "completed with credits",
			record: BillingEventRecord{
				EventType:    paddleEventTypeTransactionCompleted,
				PackCode:     "starter",
				CreditsDelta: 20,
			},
			expected: "starter credited 20 credits.",
		},
		{
			name: "completed without credits",
			record: BillingEventRecord{
				EventType: paddleEventTypeTransactionCompleted,
			},
			expected: "Payment completed.",
		},
		{
			name: "updated",
			record: BillingEventRecord{
				EventType: paddleEventTypeTransactionUpdated,
			},
			expected: "Checkout updated.",
		},
		{
			name: "created",
			record: BillingEventRecord{
				EventType: paddleEventTypeTransactionCreated,
			},
			expected: "Checkout created.",
		},
		{
			name: "default with raw summary",
			record: BillingEventRecord{
				EventType:         "custom",
				RawPayloadSummary: "raw summary",
			},
			expected: "raw summary",
		},
		{
			name: "default fallback",
			record: BillingEventRecord{
				EventType: "custom",
			},
			expected: "Billing activity recorded.",
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := billingActivitySummary(testCase.record); got != testCase.expected {
				t.Fatalf("billingActivitySummary() = %q, want %q", got, testCase.expected)
			}
		})
	}
}

func TestBillingServiceCreateCheckoutCoverage(t *testing.T) {
	if _, err := (*billingService)(nil).CreateCheckout(context.Background(), "user-1", "user@example.com", "starter", "https://site.example.com"); !errors.Is(err, ErrBillingDisabled) {
		t.Fatalf("expected disabled checkout error, got %v", err)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
	}
	if _, err := service.CreateCheckout(context.Background(), "user-1", "user@example.com", "missing", "https://site.example.com"); !errors.Is(err, ErrBillingPackUnknown) {
		t.Fatalf("expected unknown pack error, got %v", err)
	}

	expectedSession := billingCheckoutSession{
		ProviderCode:  billingProviderPaddle,
		TransactionID: "txn_123",
		CheckoutURL:   "https://checkout.example.com",
	}
	service.provider = &mockBillingProvider{
		code:            billingProviderPaddle,
		checkoutSession: expectedSession,
	}
	session, err := service.CreateCheckout(context.Background(), "user-1", "user@example.com", "starter", "https://site.example.com")
	if err != nil {
		t.Fatalf("CreateCheckout(success) error = %v", err)
	}
	if session.TransactionID != expectedSession.TransactionID {
		t.Fatalf("unexpected checkout session %#v", session)
	}
}

func TestBillingServiceCreatePortalSessionCoverage(t *testing.T) {
	if _, err := (*billingService)(nil).CreatePortalSession(context.Background(), "user-1"); !errors.Is(err, ErrBillingDisabled) {
		t.Fatalf("expected disabled portal error, got %v", err)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
	}
	if _, err := service.CreatePortalSession(context.Background(), "user-1"); !errors.Is(err, ErrBillingPortalUnavailable) {
		t.Fatalf("expected unavailable portal error without store, got %v", err)
	}

	service.store = &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return nil, errors.New("store unavailable")
		},
	}
	if _, err := service.CreatePortalSession(context.Background(), "user-1"); err == nil || !strings.Contains(err.Error(), "store unavailable") {
		t.Fatalf("expected store error, got %v", err)
	}

	service.store = &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return nil, gorm.ErrRecordNotFound
		},
	}
	if _, err := service.CreatePortalSession(context.Background(), "user-1"); !errors.Is(err, ErrBillingPortalUnavailable) {
		t.Fatalf("expected record-not-found portal error, got %v", err)
	}

	service.store = &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return &BillingCustomerLink{UserID: userID, Provider: provider, PaddleCustomerID: " "}, nil
		},
	}
	if _, err := service.CreatePortalSession(context.Background(), "user-1"); !errors.Is(err, ErrBillingPortalUnavailable) {
		t.Fatalf("expected blank customer id portal error, got %v", err)
	}

	service.provider = &mockBillingProvider{
		code:          billingProviderPaddle,
		portalSession: billingPortalSession{ProviderCode: billingProviderPaddle, URL: "https://portal.example.com"},
	}
	service.store = &mockStore{
		getBillingCustomerLinkFunc: func(userID string, provider string) (*BillingCustomerLink, error) {
			return &BillingCustomerLink{UserID: userID, Provider: provider, PaddleCustomerID: "ctm_123"}, nil
		},
	}
	portalSession, err := service.CreatePortalSession(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("CreatePortalSession(success) error = %v", err)
	}
	if portalSession.URL != "https://portal.example.com" {
		t.Fatalf("unexpected portal session %#v", portalSession)
	}
}

func TestBillingServiceHandleWebhookCoverage(t *testing.T) {
	if err := (*billingService)(nil).HandleWebhook(context.Background(), "sig", []byte(`{}`)); !errors.Is(err, ErrBillingDisabled) {
		t.Fatalf("expected disabled webhook error, got %v", err)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code:         billingProviderPaddle,
			signatureErr: errors.New("invalid signature"),
		},
		store: &mockStore{},
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); !errors.Is(err, ErrBillingUnauthorized) {
		t.Fatalf("expected unauthorized webhook error, got %v", err)
	}

	service.provider = &mockBillingProvider{
		code:     billingProviderPaddle,
		parseErr: errors.New("bad payload"),
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); !errors.Is(err, ErrBillingWebhookInvalid) {
		t.Fatalf("expected invalid webhook payload error, got %v", err)
	}

	var createCalled bool
	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		eventRecord: BillingEventRecord{
			EventID:       "evt_1",
			EventType:     paddleEventTypeTransactionUpdated,
			Provider:      billingProviderPaddle,
			TransactionID: "txn_1",
			OccurredAt:    time.Date(2026, time.March, 29, 12, 0, 0, 0, time.UTC),
		},
	}
	service.store = &mockStore{
		createBillingEventRecordFunc: func(record *BillingEventRecord) error {
			createCalled = true
			return nil
		},
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err != nil {
		t.Fatalf("HandleWebhook(no grant) error = %v", err)
	}
	if !createCalled {
		t.Fatal("expected billing event record to be created")
	}

	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		eventRecord: BillingEventRecord{
			EventID:       "evt_grant_fail",
			EventType:     paddleEventTypeTransactionCompleted,
			Provider:      billingProviderPaddle,
			TransactionID: "txn_grant_fail",
			OccurredAt:    time.Date(2026, time.March, 29, 12, 30, 0, 0, time.UTC),
		},
		grantEvent: &BillingGrantEvent{
			User:     "user-1",
			Credits:  20,
			Provider: billingProviderPaddle,
			EventID:  "evt_grant_fail",
		},
	}
	service.ledgerClient = &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			return nil, errors.New("grant failed")
		},
	}
	service.store = &mockStore{}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "grant failed") {
		t.Fatalf("expected grant failure to be returned, got %v", err)
	}
	service.ledgerClient = &mockLedgerClient{}

	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		eventRecord: BillingEventRecord{
			EventID:       "evt_2",
			EventType:     paddleEventTypeTransactionCompleted,
			Provider:      billingProviderPaddle,
			TransactionID: "txn_2",
			OccurredAt:    time.Date(2026, time.March, 29, 13, 0, 0, 0, time.UTC),
		},
		customerLink: &BillingCustomerLink{
			UserID:           "user-1",
			Provider:         billingProviderPaddle,
			PaddleCustomerID: "ctm_123",
			Email:            "user@example.com",
		},
		grantEvent: &BillingGrantEvent{
			User:     "user-1",
			Credits:  20,
			Provider: billingProviderPaddle,
			EventID:  "evt_2",
		},
	}
	service.store = &mockStore{
		upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
			return errors.New("link upsert failed")
		},
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "link upsert failed") {
		t.Fatalf("expected customer link upsert error, got %v", err)
	}

	service.store = &mockStore{
		upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
			return nil
		},
		createBillingEventRecordFunc: func(record *BillingEventRecord) error {
			return errors.New("duplicate key value violates unique constraint")
		},
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err != nil {
		t.Fatalf("expected duplicate event record error to be ignored, got %v", err)
	}

	service.store = &mockStore{
		upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
			return nil
		},
		createBillingEventRecordFunc: func(record *BillingEventRecord) error {
			return errors.New("event insert failed")
		},
	}
	if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "event insert failed") {
		t.Fatalf("expected event record failure, got %v", err)
	}
}

func TestBillingServiceHelperCoverage(t *testing.T) {
	service := &billingService{}
	if service.shouldIgnoreStaleEvent(BillingEventRecord{}) {
		t.Fatal("expected empty transaction record to not be stale")
	}

	service.store = &mockStore{
		getLatestBillingEventRecordForTransactionFunc: func(provider string, transactionID string) (*BillingEventRecord, error) {
			return nil, errors.New("lookup failed")
		},
	}
	if service.shouldIgnoreStaleEvent(BillingEventRecord{Provider: billingProviderPaddle, TransactionID: "txn_1", OccurredAt: time.Now().UTC()}) {
		t.Fatal("expected lookup error to skip stale detection")
	}

	service.store = &mockStore{
		getLatestBillingEventRecordForTransactionFunc: func(provider string, transactionID string) (*BillingEventRecord, error) {
			return &BillingEventRecord{OccurredAt: time.Date(2026, time.March, 29, 11, 0, 0, 0, time.UTC)}, nil
		},
	}
	if service.shouldIgnoreStaleEvent(BillingEventRecord{Provider: billingProviderPaddle, TransactionID: "txn_1", OccurredAt: time.Date(2026, time.March, 29, 12, 0, 0, 0, time.UTC)}) {
		t.Fatal("expected newer incoming event to not be stale")
	}

	if err := (*billingService)(nil).applyGrantEvent(context.Background(), BillingGrantEvent{}); err == nil || !strings.Contains(err.Error(), "ledger client is required") {
		t.Fatalf("expected nil ledger client error, got %v", err)
	}

	alreadyExistsService := &billingService{
		cfg: validBillingConfig(),
		ledgerClient: &mockLedgerClient{
			grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				return nil, status.Error(codes.AlreadyExists, "duplicate")
			},
		},
	}
	if err := alreadyExistsService.applyGrantEvent(context.Background(), BillingGrantEvent{User: "user-1", Credits: 20, Provider: billingProviderPaddle, EventID: "evt_1"}); err != nil {
		t.Fatalf("expected already-exists grant to be ignored, got %v", err)
	}

	errorService := &billingService{
		cfg: validBillingConfig(),
		ledgerClient: &mockLedgerClient{
			grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				return nil, errors.New("grant failed")
			},
		},
	}
	if err := errorService.applyGrantEvent(context.Background(), BillingGrantEvent{User: "user-1", Credits: 20, Provider: billingProviderPaddle, EventID: "evt_1"}); err == nil || !strings.Contains(err.Error(), "grant failed") {
		t.Fatalf("expected grant error, got %v", err)
	}

	testCases := []struct {
		name string
		err  error
		want bool
	}{
		{name: "nil", err: nil, want: false},
		{name: "unique", err: errors.New("unique constraint failed"), want: true},
		{name: "duplicate", err: errors.New("duplicate entry"), want: true},
		{name: "other", err: errors.New("boom"), want: false},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := isUniqueConstraintError(testCase.err); got != testCase.want {
				t.Fatalf("isUniqueConstraintError(%v) = %v, want %v", testCase.err, got, testCase.want)
			}
		})
	}

	if got := buildAbsoluteRequestURL(nil, "/billing"); got != "/billing" {
		t.Fatalf("unexpected nil-request url %q", got)
	}

	request := httptest.NewRequest(http.MethodGet, "http://localhost/billing", nil)
	request.TLS = &tls.ConnectionState{}
	if got := buildAbsoluteRequestURL(request, "/billing"); got != "https://localhost/billing" {
		t.Fatalf("unexpected tls url %q", got)
	}

	forwardedRequest := httptest.NewRequest(http.MethodGet, "http://localhost/billing", nil)
	forwardedRequest.Host = "internal.example.com"
	forwardedRequest.Header.Set("X-Forwarded-Proto", "https")
	forwardedRequest.Header.Set("X-Forwarded-Host", "billing.example.com")
	if got := buildAbsoluteRequestURL(forwardedRequest, "/billing"); got != "https://billing.example.com/billing" {
		t.Fatalf("unexpected forwarded url %q", got)
	}
}
