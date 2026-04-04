package crosswordapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	creditv1 "github.com/MarkoPoloResearchLab/ledger/api/credit/v1"
	sharedbilling "github.com/tyemirov/utils/billing"
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
		// Billing is fail-closed: only advertise portal availability when the
		// persisted provider customer link is present and complete.
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

func (service *billingService) SyncUserBillingEvents(ctx context.Context, userID string, userEmail string) error {
	if service == nil || service.provider == nil {
		return ErrBillingDisabled
	}

	syncProvider, ok := service.provider.(billingUserSyncProvider)
	if !ok {
		return sharedbilling.ErrBillingUserSyncFailed
	}

	normalizedUserEmail := strings.ToLower(strings.TrimSpace(userEmail))
	if normalizedUserEmail == "" {
		return sharedbilling.ErrBillingUserEmailInvalid
	}

	syncEvents, err := syncProvider.BuildUserSyncEvents(ctx, normalizedUserEmail)
	if err != nil {
		return fmt.Errorf("%w: %w", sharedbilling.ErrBillingUserSyncFailed, err)
	}

	normalizedUserID := strings.TrimSpace(userID)
	for _, syncEvent := range syncEvents {
		if !isBillingTransactionEventType(syncEvent.EventType) {
			continue
		}
		if err := service.processSharedProviderEvent(ctx, syncEvent, normalizedUserID); err != nil {
			return fmt.Errorf("%w: %w", sharedbilling.ErrBillingUserSyncFailed, err)
		}
	}

	return nil
}

func (service *billingService) ReconcileCheckout(
	ctx context.Context,
	userID string,
	userEmail string,
	transactionID string,
) (billingCheckoutReconcileResult, error) {
	result := billingCheckoutReconcileResult{
		ProviderCode: service.providerCode(),
		Status:       string(sharedbilling.CheckoutEventStatusUnknown),
	}
	if service == nil || service.provider == nil {
		return result, ErrBillingDisabled
	}

	reconcileProvider, ok := service.provider.(billingCheckoutReconcileProvider)
	if !ok {
		return result, sharedbilling.ErrBillingCheckoutReconciliationUnsupported
	}

	normalizedUserEmail := strings.ToLower(strings.TrimSpace(userEmail))
	if normalizedUserEmail == "" {
		return result, sharedbilling.ErrBillingUserEmailInvalid
	}

	normalizedTransactionID := strings.TrimSpace(transactionID)
	if normalizedTransactionID == "" {
		return result, sharedbilling.ErrPaddleAPITransactionNotFound
	}
	result.TransactionID = normalizedTransactionID

	webhookEvent, checkoutUserEmail, err := reconcileProvider.BuildCheckoutReconcileEvent(ctx, normalizedTransactionID)
	if err != nil {
		return result, err
	}

	result.Status = string(resolveBillingCheckoutEventStatus(service.provider, webhookEvent.EventType))

	normalizedCheckoutUserEmail := strings.ToLower(strings.TrimSpace(checkoutUserEmail))
	if normalizedCheckoutUserEmail != normalizedUserEmail {
		return result, fmt.Errorf("%w: %s", sharedbilling.ErrBillingCheckoutOwnershipMismatch, normalizedTransactionID)
	}
	if result.Status == string(sharedbilling.CheckoutEventStatusPending) {
		return result, nil
	}

	if err := service.processSharedProviderEvent(ctx, webhookEvent, strings.TrimSpace(userID)); err != nil {
		return result, err
	}

	return result, nil
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
	// Portal creation is intentionally fail-closed. If the stored provider
	// customer identifier is missing, billing remains blocked until the
	// customer link is repaired instead of attempting fallback resolution.
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
	return service.processProviderEvent(ctx, providerEvent)
}

func (service *billingService) applyGrantEvent(ctx context.Context, grantEvent BillingGrantEvent) error {
	if service == nil || service.ledgerClient == nil {
		return fmt.Errorf("ledger client is required")
	}

	resolvedUserID, resolveErr := service.resolveBillingGrantUserID(grantEvent)
	if resolveErr != nil {
		return resolveErr
	}

	requestCtx, cancel := context.WithTimeout(ctx, service.cfg.LedgerTimeout)
	defer cancel()

	_, err := service.ledgerClient.Grant(requestCtx, &creditv1.GrantRequest{
		UserId:           resolvedUserID,
		AmountCents:      grantEvent.Credits * service.cfg.CoinValueCents,
		IdempotencyKey:   buildBillingGrantIdempotencyKey(grantEvent),
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

func (service *billingService) processSharedProviderEvent(
	ctx context.Context,
	event sharedbilling.WebhookEvent,
	fallbackUserID string,
) error {
	if service == nil || service.provider == nil {
		return ErrBillingDisabled
	}

	payload, err := wrapBillingWebhookPayload(event)
	if err != nil {
		return err
	}
	providerEvent, err := service.provider.ParseWebhookEvent(payload)
	if err != nil {
		return err
	}

	normalizedFallbackUserID := strings.TrimSpace(fallbackUserID)
	if normalizedFallbackUserID != "" {
		if strings.TrimSpace(providerEvent.EventRecord.UserID) == "" {
			providerEvent.EventRecord.UserID = normalizedFallbackUserID
		}
		if providerEvent.CustomerLink != nil && strings.TrimSpace(providerEvent.CustomerLink.UserID) == "" {
			providerEvent.CustomerLink.UserID = normalizedFallbackUserID
		}
		if providerEvent.GrantEvent != nil && strings.TrimSpace(providerEvent.GrantEvent.User) == "" {
			providerEvent.GrantEvent.User = normalizedFallbackUserID
		}
	}

	return service.processProviderEvent(ctx, providerEvent)
}

func (service *billingService) processProviderEvent(ctx context.Context, providerEvent billingProviderEvent) error {
	if service == nil || service.provider == nil {
		return ErrBillingDisabled
	}
	if service.store == nil {
		return fmt.Errorf("billing store is required")
	}

	providerCode := service.providerCode()
	if strings.TrimSpace(providerEvent.EventRecord.Provider) == "" {
		providerEvent.EventRecord.Provider = providerCode
	}
	if providerEvent.CustomerLink != nil && strings.TrimSpace(providerEvent.CustomerLink.Provider) == "" {
		providerEvent.CustomerLink.Provider = providerCode
	}
	if providerEvent.GrantEvent != nil && strings.TrimSpace(providerEvent.GrantEvent.Provider) == "" {
		providerEvent.GrantEvent.Provider = providerCode
	}

	skipEventRecord := false
	if providerEvent.GrantEvent != nil {
		grantEvent := *providerEvent.GrantEvent
		resolvedUserID := strings.TrimSpace(grantEvent.User)
		if resolvedUserID == "" {
			var resolveErr error
			resolvedUserID, resolveErr = service.resolveBillingGrantUserID(grantEvent)
			if resolveErr != nil && !errors.Is(resolveErr, sharedbilling.ErrGrantRecipientUnresolved) {
				return resolveErr
			}
			grantEvent.User = resolvedUserID
		}
		if strings.TrimSpace(providerEvent.EventRecord.UserID) == "" {
			providerEvent.EventRecord.UserID = strings.TrimSpace(resolvedUserID)
		}
		if providerEvent.CustomerLink != nil && strings.TrimSpace(providerEvent.CustomerLink.UserID) == "" {
			providerEvent.CustomerLink.UserID = strings.TrimSpace(resolvedUserID)
		}

		duplicateCreditedTransaction, err := service.hasCreditedTransaction(providerEvent.EventRecord)
		if err != nil {
			return err
		}
		if duplicateCreditedTransaction {
			skipEventRecord = true
		} else if err := service.applyGrantEvent(ctx, grantEvent); err != nil && !errors.Is(err, sharedbilling.ErrGrantRecipientUnresolved) {
			return err
		}
	}

	if providerEvent.CustomerLink != nil && strings.TrimSpace(providerEvent.CustomerLink.UserID) != "" {
		if err := service.store.UpsertBillingCustomerLink(providerEvent.CustomerLink); err != nil {
			return err
		}
	}

	if skipEventRecord {
		return nil
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

func (service *billingService) hasCreditedTransaction(record BillingEventRecord) (bool, error) {
	if service == nil || service.store == nil {
		return false, nil
	}
	if record.CreditsDelta <= 0 {
		return false, nil
	}

	transactionID := strings.TrimSpace(record.TransactionID)
	if transactionID == "" {
		return false, nil
	}

	exists, err := service.store.HasBillingCreditedTransaction(service.providerCode(), transactionID)
	if err != nil {
		return false, err
	}
	if exists && service.logger != nil {
		service.logger.Info(
			"skipping duplicate credited billing transaction",
			zap.String("provider", service.providerCode()),
			zap.String("transaction_id", transactionID),
			zap.String("event_id", strings.TrimSpace(record.EventID)),
		)
	}
	return exists, nil
}

func buildBillingGrantIdempotencyKey(grantEvent BillingGrantEvent) string {
	normalizedProvider := strings.TrimSpace(grantEvent.Provider)
	normalizedReference := strings.TrimSpace(grantEvent.Reference)
	if normalizedReference != "" {
		return fmt.Sprintf("billing:%s:%s", normalizedProvider, normalizedReference)
	}
	return fmt.Sprintf("billing:%s:%s", normalizedProvider, strings.TrimSpace(grantEvent.EventID))
}

func isBillingTransactionEventType(eventType string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(eventType)), "transaction.")
}

func resolveBillingCheckoutEventStatus(provider billingProvider, eventType string) sharedbilling.CheckoutEventStatus {
	if checkoutEventStatusProvider, ok := provider.(billingCheckoutEventStatusProvider); ok {
		resolvedStatus := checkoutEventStatusProvider.ResolveCheckoutEventStatus(eventType)
		if resolvedStatus != "" {
			return resolvedStatus
		}
	}
	return sharedbilling.CheckoutEventStatusUnknown
}

func (service *billingService) providerCode() string {
	if service == nil || service.provider == nil {
		return ""
	}
	return strings.TrimSpace(service.provider.Code())
}

func wrapBillingWebhookPayload(event sharedbilling.WebhookEvent) ([]byte, error) {
	type billingPayloadEnvelope struct {
		Data json.RawMessage `json:"data"`
	}
	type billingWrappedWebhookEvent struct {
		EventID    string          `json:"event_id"`
		EventType  string          `json:"event_type"`
		OccurredAt string          `json:"occurred_at"`
		Data       json.RawMessage `json:"data"`
	}

	envelope := billingPayloadEnvelope{}
	if err := json.Unmarshal(event.Payload, &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Data) == 0 {
		return nil, fmt.Errorf("billing webhook payload missing data")
	}

	return json.Marshal(billingWrappedWebhookEvent{
		EventID:    strings.TrimSpace(event.EventID),
		EventType:  strings.TrimSpace(event.EventType),
		OccurredAt: event.OccurredAt.UTC().Format(time.RFC3339Nano),
		Data:       envelope.Data,
	})
}

func (service *billingService) resolveBillingGrantUserID(grantEvent BillingGrantEvent) (string, error) {
	resolvedUserID := strings.TrimSpace(grantEvent.User)
	if resolvedUserID != "" {
		return resolvedUserID, nil
	}
	if service == nil || service.store == nil {
		return "", sharedbilling.ErrGrantRecipientUnresolved
	}
	userEmail := strings.ToLower(strings.TrimSpace(grantEvent.Metadata["user_email"]))
	if userEmail == "" {
		userEmail = strings.ToLower(strings.TrimSpace(grantEvent.Metadata["billing_user_email"]))
	}
	if userEmail == "" {
		return "", sharedbilling.ErrGrantRecipientUnresolved
	}
	profile, err := service.store.GetUserProfileByEmail(userEmail)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", sharedbilling.ErrGrantRecipientUnresolved
		}
		return "", err
	}
	resolvedUserID = strings.TrimSpace(profile.UserID)
	if resolvedUserID == "" {
		return "", sharedbilling.ErrGrantRecipientUnresolved
	}
	return resolvedUserID, nil
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
