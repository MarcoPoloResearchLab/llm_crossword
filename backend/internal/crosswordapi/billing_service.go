package crosswordapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"gorm.io/gorm"
)

var (
	ErrBillingDisabled          = errors.New("billing.disabled")
	ErrBillingPackUnknown       = errors.New("billing.pack.unknown")
	ErrBillingPortalUnavailable = errors.New("billing.portal.unavailable")
	ErrBillingUnauthorized      = errors.New("billing.webhook.unauthorized")
	ErrBillingWebhookInvalid    = errors.New("billing.webhook.invalid")
)

type billingSummary struct {
	Enabled         bool                   `json:"enabled"`
	ProviderCode    string                 `json:"provider_code,omitempty"`
	Packs           []BillingPack          `json:"packs"`
	Activity        []BillingActivityEntry `json:"activity"`
	PortalAvailable bool                   `json:"portal_available"`
}

type billingService struct {
	cfg          Config
	ledgerClient creditv1.CreditServiceClient
	logger       *zap.Logger
	provider     billingProvider
	store        Store
}

func newBillingService(cfg Config, ledgerClient creditv1.CreditServiceClient, store Store, logger *zap.Logger) (*billingService, error) {
	if !cfg.BillingEnabled() {
		return nil, nil
	}

	var provider billingProvider
	switch strings.ToLower(strings.TrimSpace(cfg.BillingProvider)) {
	case billingProviderPaddle:
		paddleProvider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			return nil, err
		}
		provider = paddleProvider
	default:
		return nil, fmt.Errorf("unsupported billing provider %q", cfg.BillingProvider)
	}

	return &billingService{
		cfg:          cfg,
		ledgerClient: ledgerClient,
		logger:       logger,
		provider:     provider,
		store:        store,
	}, nil
}

func (service *billingService) Summary(ctx context.Context, userID string) (*billingSummary, error) {
	summary := &billingSummary{
		Enabled:         service != nil && service.provider != nil,
		Packs:           []BillingPack{},
		Activity:        []BillingActivityEntry{},
		PortalAvailable: false,
	}
	if service == nil || service.provider == nil {
		return summary, nil
	}

	summary.ProviderCode = service.provider.Code()
	summary.Packs = service.cfg.NormalizedBillingPacks()

	if service.store != nil {
		customerLink, err := service.store.GetBillingCustomerLink(userID, service.provider.Code())
		if err == nil && strings.TrimSpace(customerLink.PaddleCustomerID) != "" {
			summary.PortalAvailable = true
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}

		records, err := service.store.ListBillingEventRecords(userID, service.provider.Code(), billingActivityLimit)
		if err != nil {
			return nil, err
		}
		summary.Activity = mapBillingActivity(records)
	}

	return summary, nil
}

func mapBillingActivity(records []BillingEventRecord) []BillingActivityEntry {
	entries := make([]BillingActivityEntry, 0, len(records))
	for _, record := range records {
		entry := BillingActivityEntry{
			EventID:       record.EventID,
			EventType:     record.EventType,
			TransactionID: record.TransactionID,
			PackCode:      record.PackCode,
			CreditsDelta:  record.CreditsDelta,
			Status:        record.Status,
			Summary:       billingActivitySummary(record),
		}
		if !record.OccurredAt.IsZero() {
			entry.OccurredAt = record.OccurredAt.UTC().Format(time.RFC3339)
		}
		if record.ProcessedAt != nil && !record.ProcessedAt.IsZero() {
			entry.ProcessedAt = record.ProcessedAt.UTC().Format(time.RFC3339)
		}
		entries = append(entries, entry)
	}
	return entries
}

func billingActivitySummary(record BillingEventRecord) string {
	packCode := normalizeBillingPackCode(record.PackCode)
	switch record.EventType {
	case paddleEventTypeTransactionCompleted:
		if packCode != "" && record.CreditsDelta > 0 {
			return fmt.Sprintf("%s credited %d credits.", packCode, record.CreditsDelta)
		}
		return "Payment completed."
	case paddleEventTypeTransactionUpdated:
		return "Checkout updated."
	case paddleEventTypeTransactionCreated:
		return "Checkout created."
	default:
		if strings.TrimSpace(record.RawPayloadSummary) != "" {
			return record.RawPayloadSummary
		}
		return "Billing activity recorded."
	}
}

func (service *billingService) CreateCheckout(ctx context.Context, userID string, userEmail string, packCode string, returnURL string) (billingCheckoutSession, error) {
	if service == nil || service.provider == nil {
		return billingCheckoutSession{}, ErrBillingDisabled
	}
	pack, ok := service.cfg.FindBillingPack(packCode)
	if !ok {
		return billingCheckoutSession{}, ErrBillingPackUnknown
	}
	return service.provider.CreateCheckout(ctx, userID, userEmail, pack, returnURL)
}

func (service *billingService) CreatePortalSession(ctx context.Context, userID string) (billingPortalSession, error) {
	if service == nil || service.provider == nil {
		return billingPortalSession{}, ErrBillingDisabled
	}
	if service.store == nil {
		return billingPortalSession{}, ErrBillingPortalUnavailable
	}

	customerLink, err := service.store.GetBillingCustomerLink(userID, service.provider.Code())
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return billingPortalSession{}, ErrBillingPortalUnavailable
		}
		return billingPortalSession{}, err
	}
	if strings.TrimSpace(customerLink.PaddleCustomerID) == "" {
		return billingPortalSession{}, ErrBillingPortalUnavailable
	}
	return service.provider.CreatePortalSession(ctx, *customerLink)
}

func (service *billingService) HandleWebhook(ctx context.Context, signatureHeader string, payload []byte) error {
	if service == nil || service.provider == nil {
		return ErrBillingDisabled
	}
	if err := service.provider.VerifyWebhookSignature(signatureHeader, payload); err != nil {
		return fmt.Errorf("%w: %v", ErrBillingUnauthorized, err)
	}

	providerEvent, err := service.provider.ParseWebhookEvent(payload)
	if err != nil {
		return fmt.Errorf("%w: %v", ErrBillingWebhookInvalid, err)
	}

	if providerEvent.GrantEvent != nil {
		if err := service.applyGrantEvent(ctx, *providerEvent.GrantEvent); err != nil {
			return err
		}
	}

	if providerEvent.CustomerLink != nil && providerEvent.GrantEvent != nil {
		if err := service.store.UpsertBillingCustomerLink(providerEvent.CustomerLink); err != nil {
			return err
		}
	}

	processedAt := time.Now().UTC()
	providerEvent.EventRecord.ProcessedAt = &processedAt
	if err := service.store.CreateBillingEventRecord(&providerEvent.EventRecord); err != nil {
		if isUniqueConstraintError(err) {
			return nil
		}
		return err
	}
	return nil
}

func (service *billingService) applyGrantEvent(ctx context.Context, grantEvent BillingGrantEvent) error {
	if service == nil || service.ledgerClient == nil {
		return fmt.Errorf("ledger client is required")
	}

	requestCtx, cancel := context.WithTimeout(ctx, service.cfg.LedgerTimeout)
	defer cancel()

	_, err := service.ledgerClient.Grant(requestCtx, &creditv1.GrantRequest{
		UserId:           grantEvent.User,
		AmountCents:      grantEvent.Credits * service.cfg.CoinValueCents,
		IdempotencyKey:   fmt.Sprintf("billing:%s:%s", grantEvent.Provider, grantEvent.EventID),
		MetadataJson:     marshalMetadata(grantEvent.Metadata),
		ExpiresAtUnixUtc: 0,
		LedgerId:         service.cfg.DefaultLedgerID,
		TenantId:         service.cfg.DefaultTenantID,
	})
	if err != nil {
		if status.Code(err) == codes.AlreadyExists {
			return nil
		}
		return err
	}
	return nil
}

func isUniqueConstraintError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unique") || strings.Contains(message, "duplicate")
}

func buildAbsoluteRequestURL(request *http.Request, path string) string {
	if request == nil {
		return path
	}
	scheme := strings.TrimSpace(request.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		if request.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	host := strings.TrimSpace(request.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(request.Host)
	}
	return fmt.Sprintf("%s://%s%s", scheme, host, path)
}
