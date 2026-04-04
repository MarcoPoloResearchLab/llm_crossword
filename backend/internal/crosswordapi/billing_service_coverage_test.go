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
	sharedbilling "github.com/tyemirov/utils/billing"
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
	if summary.Enabled || summary.PortalAvailable || len(summary.Packs) != 0 || len(summary.Activity) != 0 {
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

func TestBillingServiceResolveBillingGrantUserIDCoverage(t *testing.T) {
	t.Run("uses explicit user id", func(t *testing.T) {
		service := &billingService{}
		resolvedUserID, err := service.resolveBillingGrantUserID(BillingGrantEvent{User: " explicit-user "})
		if err != nil {
			t.Fatalf("resolveBillingGrantUserID(explicit) error = %v", err)
		}
		if resolvedUserID != "explicit-user" {
			t.Fatalf("unexpected explicit resolved user id %q", resolvedUserID)
		}
	})

	t.Run("rejects nil store", func(t *testing.T) {
		var service *billingService
		_, err := service.resolveBillingGrantUserID(BillingGrantEvent{})
		if !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
			t.Fatalf("expected unresolved recipient error, got %v", err)
		}
	})

	t.Run("resolves user_email metadata", func(t *testing.T) {
		var lookedUpEmail string
		service := &billingService{
			store: &mockStore{
				getUserProfileByEmailFunc: func(email string) (*UserProfile, error) {
					lookedUpEmail = email
					return &UserProfile{UserID: "mapped-user"}, nil
				},
			},
		}

		resolvedUserID, err := service.resolveBillingGrantUserID(BillingGrantEvent{
			Metadata: map[string]string{"user_email": " User@Example.com "},
		})
		if err != nil {
			t.Fatalf("resolveBillingGrantUserID(user_email) error = %v", err)
		}
		if lookedUpEmail != "user@example.com" || resolvedUserID != "mapped-user" {
			t.Fatalf("unexpected user_email lookup result: lookedUpEmail=%q resolvedUserID=%q", lookedUpEmail, resolvedUserID)
		}
	})

	t.Run("resolves billing_user_email metadata", func(t *testing.T) {
		service := &billingService{
			store: &mockStore{
				getUserProfileByEmailFunc: func(email string) (*UserProfile, error) {
					if email != "fallback@example.com" {
						t.Fatalf("unexpected fallback lookup email %q", email)
					}
					return &UserProfile{UserID: "fallback-user"}, nil
				},
			},
		}

		resolvedUserID, err := service.resolveBillingGrantUserID(BillingGrantEvent{
			Metadata: map[string]string{"billing_user_email": " fallback@example.com "},
		})
		if err != nil {
			t.Fatalf("resolveBillingGrantUserID(billing_user_email) error = %v", err)
		}
		if resolvedUserID != "fallback-user" {
			t.Fatalf("unexpected fallback resolved user id %q", resolvedUserID)
		}
	})

	t.Run("rejects missing metadata", func(t *testing.T) {
		service := &billingService{store: &mockStore{}}
		_, err := service.resolveBillingGrantUserID(BillingGrantEvent{Metadata: map[string]string{}})
		if !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
			t.Fatalf("expected unresolved recipient error, got %v", err)
		}
	})

	t.Run("record not found is unresolved", func(t *testing.T) {
		service := &billingService{
			store: &mockStore{
				getUserProfileByEmailFunc: func(string) (*UserProfile, error) {
					return nil, gorm.ErrRecordNotFound
				},
			},
		}
		_, err := service.resolveBillingGrantUserID(BillingGrantEvent{
			Metadata: map[string]string{"user_email": "missing@example.com"},
		})
		if !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
			t.Fatalf("expected unresolved recipient error, got %v", err)
		}
	})

	t.Run("store error is returned", func(t *testing.T) {
		service := &billingService{
			store: &mockStore{
				getUserProfileByEmailFunc: func(string) (*UserProfile, error) {
					return nil, errors.New("lookup failed")
				},
			},
		}
		_, err := service.resolveBillingGrantUserID(BillingGrantEvent{
			Metadata: map[string]string{"user_email": "broken@example.com"},
		})
		if err == nil || !strings.Contains(err.Error(), "lookup failed") {
			t.Fatalf("expected store lookup error, got %v", err)
		}
	})

	t.Run("blank resolved user id is unresolved", func(t *testing.T) {
		service := &billingService{
			store: &mockStore{
				getUserProfileByEmailFunc: func(string) (*UserProfile, error) {
					return &UserProfile{UserID: " "}, nil
				},
			},
		}
		_, err := service.resolveBillingGrantUserID(BillingGrantEvent{
			Metadata: map[string]string{"user_email": "blank@example.com"},
		})
		if !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
			t.Fatalf("expected unresolved recipient error for blank user id, got %v", err)
		}
	})
}

func TestBillingServiceSyncUserBillingEventsCoverage(t *testing.T) {
	if err := (*billingService)(nil).SyncUserBillingEvents(context.Background(), "user-1", "user@example.com"); !errors.Is(err, ErrBillingDisabled) {
		t.Fatalf("expected disabled sync error, got %v", err)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider:     &mockBillingProvider{code: billingProviderPaddle},
		store:        &mockStore{},
	}
	if err := service.SyncUserBillingEvents(context.Background(), "user-1", " "); !errors.Is(err, sharedbilling.ErrBillingUserEmailInvalid) {
		t.Fatalf("expected invalid email sync error, got %v", err)
	}

	service.provider = &mockBillingProvider{
		code:    billingProviderPaddle,
		syncErr: errors.New("provider sync failed"),
	}
	if err := service.SyncUserBillingEvents(context.Background(), "user-1", "user@example.com"); err == nil || !errors.Is(err, sharedbilling.ErrBillingUserSyncFailed) {
		t.Fatalf("expected wrapped sync failure, got %v", err)
	}

	var createCount int
	var grantKey string
	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		syncEvents: []sharedbilling.WebhookEvent{
			{
				ProviderCode: billingProviderPaddle,
				EventID:      "sync:subscription:ignored",
				EventType:    "subscription.updated",
				OccurredAt:   time.Date(2026, time.March, 31, 12, 0, 0, 0, time.UTC),
				Payload:      []byte(`{"data":{}}`),
			},
			{
				ProviderCode: billingProviderPaddle,
				EventID:      "sync:transaction:txn_sync",
				EventType:    paddleEventTypeTransactionCompleted,
				OccurredAt:   time.Date(2026, time.March, 31, 12, 1, 0, 0, time.UTC),
				Payload:      []byte(`{"data":{}}`),
			},
		},
		eventRecord: BillingEventRecord{
			EventID:       "evt_sync",
			EventType:     paddleEventTypeTransactionCompleted,
			Provider:      billingProviderPaddle,
			UserID:        "user-1",
			TransactionID: "txn_sync",
			CreditsDelta:  20,
			OccurredAt:    time.Date(2026, time.March, 31, 12, 1, 0, 0, time.UTC),
		},
		grantEvent: &BillingGrantEvent{
			User:      "user-1",
			Credits:   20,
			Provider:  billingProviderPaddle,
			EventID:   "evt_sync",
			Reference: "billing_top_up_pack:txn_sync:starter",
			Metadata:  map[string]string{"billing_pack_code": "starter"},
		},
	}
	service.ledgerClient = &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantKey = in.GetIdempotencyKey()
			return &creditv1.Empty{}, nil
		},
	}
	service.store = &mockStore{
		createBillingEventRecordFunc: func(record *BillingEventRecord) error {
			createCount += 1
			return nil
		},
	}

	if err := service.SyncUserBillingEvents(context.Background(), "user-1", "user@example.com"); err != nil {
		t.Fatalf("SyncUserBillingEvents(success) error = %v", err)
	}
	if createCount != 1 {
		t.Fatalf("expected one transaction event record, got %d", createCount)
	}
	if grantKey != "billing:paddle:billing_top_up_pack:txn_sync:starter" {
		t.Fatalf("unexpected sync grant idempotency key %q", grantKey)
	}
}

func TestBillingServiceReconcileCheckoutCoverage(t *testing.T) {
	if _, err := (*billingService)(nil).ReconcileCheckout(context.Background(), "user-1", "user@example.com", "txn_1"); !errors.Is(err, ErrBillingDisabled) {
		t.Fatalf("expected disabled reconcile error, got %v", err)
	}

	service := &billingService{
		cfg:          validBillingConfig(),
		ledgerClient: &mockLedgerClient{},
		logger:       zap.NewNop(),
		provider: &mockBillingProvider{
			code: billingProviderPaddle,
			reconcileEvent: sharedbilling.WebhookEvent{
				ProviderCode: billingProviderPaddle,
				EventID:      "reconcile:txn_pending",
				EventType:    paddleEventTypeTransactionUpdated,
				OccurredAt:   time.Date(2026, time.March, 31, 12, 2, 0, 0, time.UTC),
				Payload:      []byte(`{"data":{}}`),
			},
			reconcileEmail: "user@example.com",
			resolveStatus:  sharedbilling.CheckoutEventStatusPending,
		},
		store: &mockStore{
			createBillingEventRecordFunc: func(record *BillingEventRecord) error {
				t.Fatalf("unexpected create billing event for pending reconcile: %#v", record)
				return nil
			},
		},
	}

	result, err := service.ReconcileCheckout(context.Background(), "user-1", "user@example.com", "txn_pending")
	if err != nil {
		t.Fatalf("ReconcileCheckout(pending) error = %v", err)
	}
	if result.Status != string(sharedbilling.CheckoutEventStatusPending) {
		t.Fatalf("unexpected pending reconcile result %#v", result)
	}

	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		reconcileEvent: sharedbilling.WebhookEvent{
			ProviderCode: billingProviderPaddle,
			EventID:      "reconcile:txn_mismatch",
			EventType:    paddleEventTypeTransactionCompleted,
			OccurredAt:   time.Date(2026, time.March, 31, 12, 3, 0, 0, time.UTC),
			Payload:      []byte(`{"data":{}}`),
		},
		reconcileEmail: "other@example.com",
		resolveStatus:  sharedbilling.CheckoutEventStatusSucceeded,
	}
	if _, err := service.ReconcileCheckout(context.Background(), "user-1", "user@example.com", "txn_mismatch"); !errors.Is(err, sharedbilling.ErrBillingCheckoutOwnershipMismatch) {
		t.Fatalf("expected ownership mismatch, got %v", err)
	}

	var grantKey string
	service.provider = &mockBillingProvider{
		code: billingProviderPaddle,
		reconcileEvent: sharedbilling.WebhookEvent{
			ProviderCode: billingProviderPaddle,
			EventID:      "reconcile:txn_paid",
			EventType:    paddleEventTypeTransactionCompleted,
			OccurredAt:   time.Date(2026, time.March, 31, 12, 4, 0, 0, time.UTC),
			Payload:      []byte(`{"data":{}}`),
		},
		reconcileEmail: "user@example.com",
		resolveStatus:  sharedbilling.CheckoutEventStatusSucceeded,
		eventRecord: BillingEventRecord{
			EventID:       "evt_reconcile",
			EventType:     paddleEventTypeTransactionCompleted,
			Provider:      billingProviderPaddle,
			UserID:        "user-1",
			TransactionID: "txn_paid",
			CreditsDelta:  20,
			OccurredAt:    time.Date(2026, time.March, 31, 12, 4, 0, 0, time.UTC),
		},
		grantEvent: &BillingGrantEvent{
			User:      "user-1",
			Credits:   20,
			Provider:  billingProviderPaddle,
			EventID:   "evt_reconcile",
			Reference: "billing_top_up_pack:txn_paid:starter",
			Metadata:  map[string]string{"billing_pack_code": "starter"},
		},
	}
	service.ledgerClient = &mockLedgerClient{
		grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
			grantKey = in.GetIdempotencyKey()
			return &creditv1.Empty{}, nil
		},
	}
	service.store = &mockStore{
		createBillingEventRecordFunc: func(record *BillingEventRecord) error {
			if record.TransactionID != "txn_paid" {
				t.Fatalf("unexpected reconcile record %#v", record)
			}
			return nil
		},
	}

	result, err = service.ReconcileCheckout(context.Background(), "user-1", "user@example.com", "txn_paid")
	if err != nil {
		t.Fatalf("ReconcileCheckout(success) error = %v", err)
	}
	if result.Status != string(sharedbilling.CheckoutEventStatusSucceeded) {
		t.Fatalf("unexpected reconcile result %#v", result)
	}
	if grantKey != "billing:paddle:billing_top_up_pack:txn_paid:starter" {
		t.Fatalf("unexpected reconcile grant idempotency key %q", grantKey)
	}
}

func TestBillingServiceProcessProviderEventSkipsCreditedDuplicates(t *testing.T) {
	service := &billingService{
		cfg: validBillingConfig(),
		ledgerClient: &mockLedgerClient{
			grantFunc: func(ctx context.Context, in *creditv1.GrantRequest, opts ...grpc.CallOption) (*creditv1.Empty, error) {
				t.Fatalf("unexpected duplicate grant request %#v", in)
				return nil, nil
			},
		},
		logger:   zap.NewNop(),
		provider: &mockBillingProvider{code: billingProviderPaddle},
		store: &mockStore{
			hasBillingCreditedTransactionFunc: func(provider string, transactionID string) (bool, error) {
				return provider == billingProviderPaddle && transactionID == "txn_duplicate", nil
			},
			upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
				if link.UserID != "user-1" {
					t.Fatalf("unexpected duplicate link %#v", link)
				}
				return nil
			},
			createBillingEventRecordFunc: func(record *BillingEventRecord) error {
				t.Fatalf("unexpected duplicate event record %#v", record)
				return nil
			},
		},
	}

	err := service.processProviderEvent(context.Background(), billingProviderEvent{
		CustomerLink: &BillingCustomerLink{
			UserID:           "user-1",
			Provider:         billingProviderPaddle,
			PaddleCustomerID: "ctm_duplicate",
			Email:            "user@example.com",
		},
		EventRecord: BillingEventRecord{
			EventID:       "evt_duplicate",
			EventType:     paddleEventTypeTransactionCompleted,
			Provider:      billingProviderPaddle,
			UserID:        "user-1",
			TransactionID: "txn_duplicate",
			CreditsDelta:  20,
			OccurredAt:    time.Date(2026, time.March, 31, 12, 5, 0, 0, time.UTC),
		},
		GrantEvent: &BillingGrantEvent{
			User:      "user-1",
			Credits:   20,
			Provider:  billingProviderPaddle,
			EventID:   "evt_duplicate",
			Reference: "billing_top_up_pack:txn_duplicate:starter",
		},
	})
	if err != nil {
		t.Fatalf("processProviderEvent(duplicate credited) error = %v", err)
	}
}

func TestBillingServiceApplyGrantEventResolveErrorCoverage(t *testing.T) {
	grantCalled := false
	service := &billingService{
		cfg: validBillingConfig(),
		ledgerClient: &mockLedgerClient{
			grantFunc: func(context.Context, *creditv1.GrantRequest, ...grpc.CallOption) (*creditv1.Empty, error) {
				grantCalled = true
				return &creditv1.Empty{}, nil
			},
		},
		store: &mockStore{
			getUserProfileByEmailFunc: func(string) (*UserProfile, error) {
				return nil, gorm.ErrRecordNotFound
			},
		},
	}

	err := service.applyGrantEvent(context.Background(), BillingGrantEvent{
		Credits:  20,
		Provider: billingProviderPaddle,
		EventID:  "evt_apply_unresolved",
		Metadata: map[string]string{"user_email": "missing@example.com"},
	})
	if !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
		t.Fatalf("expected unresolved recipient error, got %v", err)
	}
	if grantCalled {
		t.Fatal("expected grant RPC to be skipped when grant recipient is unresolved")
	}
}

func TestBillingServiceHandleWebhookGrantResolutionCoverage(t *testing.T) {
	t.Run("resolves recipient by email and backfills event and link", func(t *testing.T) {
		var grantRequest *creditv1.GrantRequest
		var createdRecord *BillingEventRecord
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
				eventRecord: BillingEventRecord{
					EventID:       "evt_resolved",
					EventType:     paddleEventTypeTransactionCompleted,
					Provider:      billingProviderPaddle,
					TransactionID: "txn_resolved",
					OccurredAt:    time.Date(2026, time.March, 30, 10, 0, 0, 0, time.UTC),
				},
				customerLink: &BillingCustomerLink{
					Provider:         billingProviderPaddle,
					PaddleCustomerID: "ctm_resolved",
					Email:            "user@example.com",
				},
				grantEvent: &BillingGrantEvent{
					Credits:  20,
					Provider: billingProviderPaddle,
					EventID:  "evt_resolved",
					Metadata: map[string]string{"user_email": " User@Example.com "},
				},
			},
			store: &mockStore{
				getUserProfileByEmailFunc: func(email string) (*UserProfile, error) {
					if email != "user@example.com" {
						t.Fatalf("unexpected email lookup %q", email)
					}
					return &UserProfile{UserID: "resolved-user"}, nil
				},
				upsertBillingCustomerLinkFunc: func(link *BillingCustomerLink) error {
					copyLink := *link
					upsertedLink = &copyLink
					return nil
				},
				createBillingEventRecordFunc: func(record *BillingEventRecord) error {
					copyRecord := *record
					createdRecord = &copyRecord
					return nil
				},
			},
		}

		if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err != nil {
			t.Fatalf("HandleWebhook(resolved recipient) error = %v", err)
		}
		if grantRequest == nil || grantRequest.UserId != "resolved-user" {
			t.Fatalf("expected resolved user id in grant request, got %#v", grantRequest)
		}
		if upsertedLink == nil || upsertedLink.UserID != "resolved-user" {
			t.Fatalf("expected resolved user id in customer link, got %#v", upsertedLink)
		}
		if createdRecord == nil || createdRecord.UserID != "resolved-user" {
			t.Fatalf("expected resolved user id in billing event record, got %#v", createdRecord)
		}
	})

	t.Run("returns non-unresolved lookup error", func(t *testing.T) {
		service := &billingService{
			cfg:          validBillingConfig(),
			ledgerClient: &mockLedgerClient{},
			logger:       zap.NewNop(),
			provider: &mockBillingProvider{
				code: billingProviderPaddle,
				eventRecord: BillingEventRecord{
					EventID:       "evt_lookup_fail",
					EventType:     paddleEventTypeTransactionCompleted,
					Provider:      billingProviderPaddle,
					TransactionID: "txn_lookup_fail",
					OccurredAt:    time.Date(2026, time.March, 30, 10, 30, 0, 0, time.UTC),
				},
				customerLink: &BillingCustomerLink{
					Provider:         billingProviderPaddle,
					PaddleCustomerID: "ctm_lookup_fail",
					Email:            "broken@example.com",
				},
				grantEvent: &BillingGrantEvent{
					Credits:  20,
					Provider: billingProviderPaddle,
					EventID:  "evt_lookup_fail",
					Metadata: map[string]string{"user_email": "broken@example.com"},
				},
			},
			store: &mockStore{
				getUserProfileByEmailFunc: func(string) (*UserProfile, error) {
					return nil, errors.New("lookup failed")
				},
			},
		}

		if err := service.HandleWebhook(context.Background(), "sig", []byte(`{}`)); err == nil || !strings.Contains(err.Error(), "lookup failed") {
			t.Fatalf("expected lookup failure to be returned, got %v", err)
		}
	})
}
