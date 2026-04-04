package crosswordapi

import (
	"context"
	"fmt"
	"strings"
	"time"

	sharedbilling "github.com/tyemirov/utils/billing"
)

const (
	billingProviderPaddle       = "paddle"
	paddleEnvironmentSandbox    = "sandbox"
	paddleEnvironmentProduction = "production"

	billingActivityLimit = 20
)

type BillingPack struct {
	Code         string `json:"code" yaml:"code"`
	Label        string `json:"label" yaml:"label"`
	Credits      int64  `json:"credits" yaml:"credits"`
	PriceCents   int64  `json:"price_cents" yaml:"price_cents"`
	PriceDisplay string `json:"price_display,omitempty" yaml:"-"`
}

type BillingActivityEntry struct {
	EventID       string `json:"event_id"`
	EventType     string `json:"event_type"`
	TransactionID string `json:"transaction_id"`
	PackCode      string `json:"pack_code"`
	CreditsDelta  int64  `json:"credits_delta"`
	Status        string `json:"status"`
	Summary       string `json:"summary"`
	OccurredAt    string `json:"occurred_at,omitempty"`
	ProcessedAt   string `json:"processed_at,omitempty"`
}

type BillingCustomerLink struct {
	ID               string    `gorm:"primaryKey;type:text" json:"id"`
	UserID           string    `gorm:"not null;type:text;uniqueIndex:idx_billing_customer_provider_user" json:"user_id"`
	Provider         string    `gorm:"not null;type:text;uniqueIndex:idx_billing_customer_provider_user;uniqueIndex:idx_billing_customer_provider_external" json:"provider"`
	PaddleCustomerID string    `gorm:"not null;type:text;uniqueIndex:idx_billing_customer_provider_external" json:"paddle_customer_id"`
	Email            string    `gorm:"not null;type:text;index" json:"email"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type BillingEventRecord struct {
	ID                string     `gorm:"primaryKey;type:text" json:"id"`
	Provider          string     `gorm:"not null;type:text;uniqueIndex:idx_billing_event_provider_event;index" json:"provider"`
	EventID           string     `gorm:"not null;type:text;uniqueIndex:idx_billing_event_provider_event" json:"event_id"`
	EventType         string     `gorm:"not null;type:text;index" json:"event_type"`
	UserID            string     `gorm:"type:text;index" json:"user_id"`
	UserEmail         string     `gorm:"type:text;index" json:"user_email"`
	PaddleCustomerID  string     `gorm:"type:text;index" json:"paddle_customer_id"`
	TransactionID     string     `gorm:"type:text;index" json:"transaction_id"`
	PackCode          string     `gorm:"type:text" json:"pack_code"`
	CreditsDelta      int64      `gorm:"not null;default:0" json:"credits_delta"`
	Status            string     `gorm:"type:text;index" json:"status"`
	OccurredAt        time.Time  `gorm:"index" json:"occurred_at"`
	ProcessedAt       *time.Time `json:"processed_at"`
	RawPayloadSummary string     `gorm:"type:text" json:"raw_payload_summary"`
	CreatedAt         time.Time  `json:"created_at"`
}

type BillingGrantEvent struct {
	User       string
	Credits    int64
	Reference  string
	ReasonCode string
	Metadata   map[string]string
	Provider   string
	EventID    string
}

type billingPublicConfig struct {
	Environment string
	ClientToken string
}

type billingCheckoutRequest struct {
	PackID string `json:"pack_id"`
}

type billingCheckoutReconcileRequest struct {
	TransactionID string `json:"transaction_id"`
}

type billingCheckoutSession struct {
	ProviderCode  string `json:"provider_code"`
	TransactionID string `json:"transaction_id"`
	CheckoutURL   string `json:"checkout_url"`
}

type billingCheckoutReconcileResult struct {
	ProviderCode  string `json:"provider_code"`
	TransactionID string `json:"transaction_id"`
	Status        string `json:"status"`
}

type billingPortalSession struct {
	ProviderCode string `json:"provider_code"`
	URL          string `json:"url"`
}

type billingProviderEvent struct {
	CustomerLink *BillingCustomerLink
	EventRecord  BillingEventRecord
	GrantEvent   *BillingGrantEvent
}

type billingProvider interface {
	Code() string
	PublicConfig() billingPublicConfig
	SignatureHeaderName() string
	VerifyWebhookSignature(signatureHeader string, payload []byte) error
	ParseWebhookEvent(payload []byte) (billingProviderEvent, error)
	CreateCheckout(ctx context.Context, userID string, userEmail string, pack BillingPack, returnURL string) (billingCheckoutSession, error)
	CreatePortalSession(ctx context.Context, customerLink BillingCustomerLink) (billingPortalSession, error)
}

type billingCatalogValidationProvider interface {
	ValidateCatalog(ctx context.Context) error
}

type billingUserSyncProvider interface {
	BuildUserSyncEvents(ctx context.Context, userEmail string) ([]sharedbilling.WebhookEvent, error)
}

type billingCheckoutReconcileProvider interface {
	BuildCheckoutReconcileEvent(ctx context.Context, transactionID string) (sharedbilling.WebhookEvent, string, error)
}

type billingCheckoutEventStatusProvider interface {
	ResolveCheckoutEventStatus(eventType string) sharedbilling.CheckoutEventStatus
}

func normalizeBillingPackCode(rawCode string) string {
	return strings.ToLower(strings.TrimSpace(rawCode))
}

func formatPriceDisplay(cents int64) string {
	dollars := float64(cents) / 100
	return fmt.Sprintf("$%.2f", dollars)
}

func cloneBillingPack(pack BillingPack) BillingPack {
	return BillingPack{
		Code:         normalizeBillingPackCode(pack.Code),
		Label:        strings.TrimSpace(pack.Label),
		Credits:      pack.Credits,
		PriceCents:   pack.PriceCents,
		PriceDisplay: formatPriceDisplay(pack.PriceCents),
	}
}
