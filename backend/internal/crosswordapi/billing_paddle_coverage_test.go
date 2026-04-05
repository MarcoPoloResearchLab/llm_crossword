package crosswordapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	sharedbilling "github.com/tyemirov/utils/billing"
)

type paddleRoundTripFunc func(request *http.Request) (*http.Response, error)

func (transport paddleRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func jsonHTTPResponse(statusCode int, body string) *http.Response {
	return &http.Response{
		StatusCode: statusCode,
		Header: http.Header{
			"Content-Type": []string{"application/json"},
		},
		Body: io.NopCloser(strings.NewReader(body)),
	}
}

func newTestPaddleAPIClient(transport paddleRoundTripFunc) *paddleAPIClient {
	return &paddleAPIClient{
		apiKey:  "test_api_key",
		baseURL: "https://billing.test",
		httpClient: &http.Client{
			Transport: transport,
		},
	}
}

func newTestPaddleProvider(client *paddleAPIClient) *paddleBillingProvider {
	cfg := validBillingConfig()
	return &paddleBillingProvider{
		apiClient: client,
		cfg:       cfg,
		packPrices: map[string]string{
			"starter": "pri_test_starter",
		},
	}
}

type stubSharedGrantResolver struct {
	grant       sharedbilling.WebhookGrant
	shouldGrant bool
	err         error
}

func (resolver stubSharedGrantResolver) Resolve(context.Context, sharedbilling.WebhookEvent) (sharedbilling.WebhookGrant, bool, error) {
	return resolver.grant, resolver.shouldGrant, resolver.err
}

func TestNewPaddleAPIClientAndProviderCoverage(t *testing.T) {
	if _, err := newPaddleAPIClient("staging", "test_api_key", ""); err == nil {
		t.Fatal("expected unsupported environment error")
	}
	if _, err := newPaddleAPIClient(paddleEnvironmentSandbox, "   ", ""); err == nil {
		t.Fatal("expected missing api key error")
	}

	productionClient, err := newPaddleAPIClient(paddleEnvironmentProduction, "prod_key", "")
	if err != nil {
		t.Fatalf("newPaddleAPIClient(production) error = %v", err)
	}
	if productionClient.baseURL != paddleAPIBaseURLProduction {
		t.Fatalf("unexpected production base url %q", productionClient.baseURL)
	}

	overrideClient, err := newPaddleAPIClient(paddleEnvironmentSandbox, "test_api_key", "https://override.example.com/")
	if err != nil {
		t.Fatalf("newPaddleAPIClient(override) error = %v", err)
	}
	if overrideClient.baseURL != "https://override.example.com" {
		t.Fatalf("unexpected override base url %q", overrideClient.baseURL)
	}

	provider, err := newPaddleBillingProvider(validBillingConfig())
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}
	if provider.PublicConfig().ClientToken != "test_client_token" {
		t.Fatalf("unexpected public config %#v", provider.PublicConfig())
	}
	if provider.SignatureHeaderName() != paddleSignatureHeaderName {
		t.Fatalf("unexpected signature header name %q", provider.SignatureHeaderName())
	}

	cfg := validBillingConfig()
	cfg.PaddleAPIKey = ""
	if _, err := newPaddleBillingProvider(cfg); err == nil {
		t.Fatal("expected provider creation to fail when api key is missing")
	}
}

func TestNewPaddleBillingProviderSharedErrorCoverage(t *testing.T) {
	t.Run("shared verifier init error", func(t *testing.T) {
		cfg := validBillingConfig()
		cfg.PaddleWebhookSecret = " "
		if _, err := newPaddleBillingProvider(cfg); err == nil {
			t.Fatal("expected shared verifier init error")
		}
	})

	t.Run("shared provider init error", func(t *testing.T) {
		cfg := validBillingConfig()
		cfg.PaddleClientToken = " "
		if _, err := newPaddleBillingProvider(cfg); err == nil {
			t.Fatal("expected shared provider init error")
		}
	})

	t.Run("shared grant resolver init error", func(t *testing.T) {
		originalResolverFactory := newSharedPaddleGrantResolver
		newSharedPaddleGrantResolver = func(*sharedbilling.PaddleProvider) (sharedbilling.WebhookGrantResolver, error) {
			return nil, errors.New("shared resolver failed")
		}
		t.Cleanup(func() {
			newSharedPaddleGrantResolver = originalResolverFactory
		})

		if _, err := newPaddleBillingProvider(validBillingConfig()); err == nil || !strings.Contains(err.Error(), "shared resolver failed") {
			t.Fatalf("expected shared resolver init error, got %v", err)
		}
	})
}

func TestPaddleBillingProviderValidateCatalogCoverage(t *testing.T) {
	t.Run("missing shared provider", func(t *testing.T) {
		provider := &paddleBillingProvider{}
		if err := provider.ValidateCatalog(context.Background()); !errors.Is(err, sharedbilling.ErrPaddleProviderClientUnavailable) {
			t.Fatalf("expected missing shared provider error, got %v", err)
		}
	})

	t.Run("success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method != http.MethodGet || request.URL.Path != "/prices" {
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			}
			if request.URL.Query().Get("id") != "pri_test_starter" {
				t.Fatalf("unexpected price lookup query %q", request.URL.RawQuery)
			}
			_, _ = io.WriteString(writer, `{"data":[{"id":"pri_test_starter","product_id":"pro_test_starter","name":"Starter Pack","unit_price":{"amount":"2000"},"product":{"id":"pro_test_starter","name":"Starter Pack"}}]}`)
		}))
		defer server.Close()

		cfg := validBillingConfig()
		cfg.PaddleAPIBaseURL = server.URL
		provider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			t.Fatalf("newPaddleBillingProvider() error = %v", err)
		}

		if err := provider.ValidateCatalog(context.Background()); err != nil {
			t.Fatalf("ValidateCatalog() error = %v", err)
		}
	})
}

func TestPaddleSignatureCoverage(t *testing.T) {
	cfg := validBillingConfig()
	cfg.PaddleWebhookSecret = "pdl_secret_test"
	provider, err := newPaddleBillingProvider(cfg)
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}

	payload := []byte(`{"event_id":"evt_123"}`)

	if _, _, err := parsePaddleSignatureHeader(""); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected blank signature header to fail, got %v", err)
	}
	if _, _, err := parsePaddleSignatureHeader("invalid"); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected malformed signature header to fail, got %v", err)
	}
	if _, _, err := parsePaddleSignatureHeader("ts=nope;h1=abc"); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected invalid timestamp to fail, got %v", err)
	}
	if _, _, err := parsePaddleSignatureHeader("ts=123"); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected missing hash to fail, got %v", err)
	}
	if err := provider.VerifyWebhookSignature("", payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected invalid signature header to fail verification, got %v", err)
	}

	futureTimestamp := time.Now().UTC().Add(1 * time.Minute).Unix()
	validHeader := testPaddleSignatureHeader(t, cfg.PaddleWebhookSecret, futureTimestamp, payload)
	parsedTimestamp, hashes, err := parsePaddleSignatureHeader(validHeader)
	if err != nil {
		t.Fatalf("parsePaddleSignatureHeader(valid) error = %v", err)
	}
	if parsedTimestamp != futureTimestamp || len(hashes) != 1 {
		t.Fatalf("unexpected parsed signature result: timestamp=%d hashes=%v", parsedTimestamp, hashes)
	}
	if err := provider.VerifyWebhookSignature(validHeader, payload); err != nil {
		t.Fatalf("VerifyWebhookSignature(valid future ts) error = %v", err)
	}

	oldHeader := testPaddleSignatureHeader(t, cfg.PaddleWebhookSecret, time.Now().UTC().Add(-10*time.Minute).Unix(), payload)
	if err := provider.VerifyWebhookSignature(oldHeader, payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected expired signature to fail, got %v", err)
	}

	if err := provider.VerifyWebhookSignature("ts=1;h1=deadbeef", payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected mismatched signature to fail, got %v", err)
	}
}

func testPaddleSignatureHeader(t *testing.T, secret string, timestamp int64, payload []byte) string {
	t.Helper()

	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(timestamp, 10) + ":" + string(payload)))
	return "ts=" + strconv.FormatInt(timestamp, 10) + ";h1=" + hex.EncodeToString(mac.Sum(nil))
}

func TestPaddleMetadataAndCreditHelpersCoverage(t *testing.T) {
	provider := &paddleBillingProvider{
		cfg: validBillingConfig(),
		packPrices: map[string]string{
			"starter": "pri_test_starter",
		},
	}

	if got := provider.resolveCredits("starter", "", "15"); got != 15 {
		t.Fatalf("expected metadata credits to win, got %d", got)
	}
	if got := provider.resolveCredits("starter", "", ""); got != 20 {
		t.Fatalf("expected pack-code credits, got %d", got)
	}
	if got := provider.resolveCredits("", "pri_test_starter", ""); got != 20 {
		t.Fatalf("expected price-id credits, got %d", got)
	}
	if got := provider.resolveCredits("", "", "not-a-number"); got != 0 {
		t.Fatalf("expected unresolved credits to be 0, got %d", got)
	}

	if got := readPaddleMetadataValue(nil, paddleMetadataUserIDKey); got != "" {
		t.Fatalf("expected nil metadata to return empty string, got %q", got)
	}
	if got := readPaddleMetadataValue(map[string]interface{}{paddleMetadataUserIDKey: nil}, paddleMetadataUserIDKey); got != "" {
		t.Fatalf("expected nil metadata value to return empty string, got %q", got)
	}
	if got := readPaddleMetadataValue(map[string]interface{}{paddleMetadataUserIDKey: " user-1 "}, paddleMetadataUserIDKey); got != "user-1" {
		t.Fatalf("expected trimmed string metadata, got %q", got)
	}
	if got := readPaddleMetadataValue(map[string]interface{}{paddleMetadataCreditsKey: float64(20)}, paddleMetadataCreditsKey); got != "20" {
		t.Fatalf("expected integer-like float metadata, got %q", got)
	}
	if got := readPaddleMetadataValue(map[string]interface{}{paddleMetadataCreditsKey: 12.5}, paddleMetadataCreditsKey); got != "12.5" {
		t.Fatalf("expected decimal float metadata, got %q", got)
	}
	if got := readPaddleMetadataValue(map[string]interface{}{paddleMetadataPackCodeKey: true}, paddleMetadataPackCodeKey); got != "true" {
		t.Fatalf("expected fallback metadata formatting, got %q", got)
	}

	if got := resolvePaddlePriceID([]paddleTransactionLineItem{{PriceID: " pri_direct "}}); got != "pri_direct" {
		t.Fatalf("expected direct price id, got %q", got)
	}
	if got := resolvePaddlePriceID([]paddleTransactionLineItem{{Price: struct {
		ID string `json:"id"`
	}{ID: " pri_nested "}}}); got != "pri_nested" {
		t.Fatalf("expected nested price id, got %q", got)
	}
	if got := resolvePaddlePriceID(nil); got != "" {
		t.Fatalf("expected empty price id for empty items, got %q", got)
	}

	metadata := cloneBillingMetadata(map[string]string{
		" billing_pack_code ": " starter ",
		" ":                   "ignored",
	}, " user@example.com ")
	if metadata["billing_pack_code"] != "starter" {
		t.Fatalf("expected trimmed metadata value, got %#v", metadata)
	}
	if metadata["user_email"] != "user@example.com" {
		t.Fatalf("expected user_email to be backfilled, got %#v", metadata)
	}
	if _, exists := metadata[""]; exists {
		t.Fatalf("expected blank metadata key to be skipped, got %#v", metadata)
	}
}

func TestPaddleParseWebhookEventCoverage(t *testing.T) {
	provider, err := newPaddleBillingProvider(validBillingConfig())
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}

	if _, err := provider.ParseWebhookEvent([]byte("{")); err == nil {
		t.Fatal("expected invalid json to fail")
	}

	if _, err := provider.ParseWebhookEvent([]byte(`{"event_id":"evt","event_type":"transaction.created","occurred_at":"bad-time","data":{}}`)); err == nil {
		t.Fatal("expected invalid occurred_at to fail")
	}

	completedPayload := []byte(`{
	  "event_id": "evt_completed",
	  "event_type": "transaction.completed",
	  "occurred_at": "2026-03-28T18:40:00Z",
	  "data": {
	    "id": "txn_123",
	    "status": "completed",
	    "customer_id": "ctm_123",
	    "customer": {
	      "email_address": "fallback@example.com"
	    },
	    "custom_data": {
	      "crossword_user_id": "user-123"
	    },
	    "items": [
	      {
	        "price_id": "pri_test_starter"
	      }
	    ]
	  }
	}`)

	providerEvent, err := provider.ParseWebhookEvent(completedPayload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(completed) error = %v", err)
	}
	if providerEvent.EventRecord.UserEmail != "fallback@example.com" {
		t.Fatalf("expected fallback email, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.EventRecord.CreditsDelta != 20 {
		t.Fatalf("expected price-id credits, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.GrantEvent == nil || providerEvent.CustomerLink == nil {
		t.Fatalf("expected completed event to create grant + customer link, got %#v", providerEvent)
	}

	updatedPayload := []byte(`{
	  "event_id": "evt_updated",
	  "event_type": "transaction.updated",
	  "occurred_at": "2026-03-28T18:40:00Z",
	  "data": {
	    "id": "txn_456",
	    "status": "open",
	    "customer_id": "ctm_456",
	    "customer": {
	      "email": "updated@example.com"
	    },
	    "custom_data": {
	      "pack_code": "starter"
	    },
	    "items": []
	  }
	}`)
	providerEvent, err = provider.ParseWebhookEvent(updatedPayload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(updated) error = %v", err)
	}
	if providerEvent.GrantEvent != nil || providerEvent.CustomerLink != nil {
		t.Fatalf("expected non-completed event to skip grant + link, got %#v", providerEvent)
	}
	if providerEvent.EventRecord.RawPayloadSummary != "transaction.updated open" {
		t.Fatalf("unexpected raw payload summary %#v", providerEvent.EventRecord)
	}
}

func TestPaddleParseWebhookEventLegacyCoverage(t *testing.T) {
	provider := &paddleBillingProvider{
		cfg: validBillingConfig(),
		packPrices: map[string]string{
			"starter": "pri_test_starter",
		},
	}

	if _, err := provider.ParseWebhookEvent([]byte("{")); err == nil {
		t.Fatal("expected invalid json to fail")
	}
	if _, err := provider.ParseWebhookEvent([]byte(`{"event_id":"evt","event_type":"transaction.created","occurred_at":"bad-time","data":{}}`)); err == nil {
		t.Fatal("expected invalid occurred_at to fail")
	}

	completedPayload := []byte(`{
	  "event_id": "evt_legacy_completed",
	  "event_type": "transaction.completed",
	  "occurred_at": "2026-03-28T18:40:00Z",
	  "data": {
	    "id": "txn_legacy_completed",
	    "status": "completed",
	    "customer_id": "ctm_legacy",
	    "customer": {
	      "email": "legacy@example.com"
	    },
	    "custom_data": {
	      "crossword_user_id": "legacy-user",
	      "pack_code": "starter",
	      "credits": "20"
	    }
	  }
	}`)

	providerEvent, err := provider.ParseWebhookEvent(completedPayload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(completed legacy) error = %v", err)
	}
	if providerEvent.EventRecord.UserEmail != "legacy@example.com" {
		t.Fatalf("expected legacy email fallback, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.GrantEvent == nil || providerEvent.CustomerLink == nil {
		t.Fatalf("expected completed legacy event to include grant and customer link, got %#v", providerEvent)
	}
	if providerEvent.GrantEvent.Reference != "paddle:credit_pack:txn_legacy_completed" {
		t.Fatalf("unexpected legacy grant event %#v", providerEvent.GrantEvent)
	}

	completedWithoutUserIDPayload := []byte(`{
	  "event_id": "evt_legacy_completed_email_only",
	  "event_type": "transaction.completed",
	  "occurred_at": "2026-03-28T18:42:00Z",
	  "data": {
	    "id": "txn_legacy_completed_email_only",
	    "status": "completed",
	    "customer_id": "ctm_legacy_email_only",
	    "customer": {
	      "email": "legacy-resolve@example.com"
	    },
	    "custom_data": {
	      "pack_code": "starter",
	      "credits": "20"
	    }
	  }
	}`)

	providerEvent, err = provider.ParseWebhookEvent(completedWithoutUserIDPayload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(completed legacy email only) error = %v", err)
	}
	if providerEvent.GrantEvent == nil {
		t.Fatalf("expected completed legacy email-only event to include grant, got %#v", providerEvent)
	}
	if providerEvent.GrantEvent.User != "" {
		t.Fatalf("expected unresolved legacy user id to remain blank, got %#v", providerEvent.GrantEvent)
	}
	if providerEvent.GrantEvent.Metadata["user_email"] != "legacy-resolve@example.com" {
		t.Fatalf("expected legacy email-only grant metadata to include user email, got %#v", providerEvent.GrantEvent)
	}
	if providerEvent.CustomerLink == nil || providerEvent.CustomerLink.PaddleCustomerID != "ctm_legacy_email_only" {
		t.Fatalf("expected completed legacy email-only event to include customer link, got %#v", providerEvent.CustomerLink)
	}
	if providerEvent.CustomerLink.UserID != "" {
		t.Fatalf("expected unresolved legacy customer-link user id to remain blank, got %#v", providerEvent.CustomerLink)
	}

	updatedPayload := []byte(`{
	  "event_id": "evt_legacy_updated",
	  "event_type": "transaction.updated",
	  "occurred_at": "2026-03-28T18:45:00Z",
	  "data": {
	    "id": "txn_legacy_updated",
	    "status": "open",
	    "customer": {
	      "email_address": "legacy-fallback@example.com"
	    }
	  }
	}`)

	providerEvent, err = provider.ParseWebhookEvent(updatedPayload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(updated legacy) error = %v", err)
	}
	if providerEvent.EventRecord.UserEmail != "legacy-fallback@example.com" {
		t.Fatalf("expected email_address fallback, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.GrantEvent != nil || providerEvent.CustomerLink != nil {
		t.Fatalf("expected non-completed legacy event to skip grant and customer link, got %#v", providerEvent)
	}
}

func TestPaddleLegacySignatureCoverage(t *testing.T) {
	cfg := validBillingConfig()
	cfg.PaddleWebhookSecret = "pdl_secret_test"
	provider := &paddleBillingProvider{cfg: cfg}

	if publicConfig := provider.PublicConfig(); publicConfig.ClientToken != cfg.PaddleClientToken || publicConfig.Environment != cfg.PaddleEnvironment {
		t.Fatalf("unexpected legacy public config %#v", publicConfig)
	}
	if provider.SignatureHeaderName() != paddleSignatureHeaderName {
		t.Fatalf("unexpected legacy signature header %q", provider.SignatureHeaderName())
	}

	payload := []byte(`{"event_id":"evt_legacy"}`)
	if err := provider.VerifyWebhookSignature(" ", payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected malformed legacy signature to fail, got %v", err)
	}

	futureHeader := testPaddleSignatureHeader(t, cfg.PaddleWebhookSecret, time.Now().UTC().Add(1*time.Minute).Unix(), payload)
	if err := provider.VerifyWebhookSignature(futureHeader, payload); err != nil {
		t.Fatalf("expected future legacy signature to pass, got %v", err)
	}

	expiredHeader := testPaddleSignatureHeader(t, cfg.PaddleWebhookSecret, time.Now().UTC().Add(-10*time.Minute).Unix(), payload)
	if err := provider.VerifyWebhookSignature(expiredHeader, payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected expired legacy signature to fail, got %v", err)
	}

	invalidHashHeader := testPaddleSignatureHeader(t, cfg.PaddleWebhookSecret, time.Now().UTC().Unix(), payload)
	invalidHashHeader = strings.Replace(invalidHashHeader, "h1=", "h1=deadbeef", 1)
	if err := provider.VerifyWebhookSignature(invalidHashHeader, payload); !errors.Is(err, ErrPaddleWebhookSignature) {
		t.Fatalf("expected mismatched legacy signature to fail, got %v", err)
	}
}

func TestPaddleParseSharedWebhookEventAdditionalCoverage(t *testing.T) {
	provider, err := newPaddleBillingProvider(validBillingConfig())
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}

	payload := []byte(`{
	  "event_id": "evt_shared",
	  "event_type": "transaction.completed",
	  "occurred_at": "2026-03-28T18:40:00Z",
	  "data": {
	    "id": "txn_shared",
	    "status": "completed",
	    "customer_id": "ctm_shared",
	    "customer": {
	      "email_address": "shared@example.com"
	    },
	    "custom_data": {},
	    "items": []
	  }
	}`)

	provider.sharedGrantResolver = stubSharedGrantResolver{
		err: errors.New("resolve failed"),
	}
	if _, err := provider.ParseWebhookEvent(payload); err == nil || !strings.Contains(err.Error(), "resolve failed") {
		t.Fatalf("expected shared resolver error, got %v", err)
	}

	provider.sharedGrantResolver = stubSharedGrantResolver{
		grant: sharedbilling.WebhookGrant{
			SubjectID: "shared-user",
			Credits:   25,
			Reference: "shared-ref",
			Reason:    "billing_credit_pack",
			Metadata: map[string]string{
				"billing_pack_code": "starter",
				"billing_price_id":  "pri_test_starter",
			},
		},
		shouldGrant: true,
	}
	providerEvent, err := provider.ParseWebhookEvent(payload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent(shared fallback) error = %v", err)
	}
	if providerEvent.EventRecord.UserEmail != "shared@example.com" {
		t.Fatalf("expected shared email_address fallback, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.EventRecord.PackCode != "starter" || providerEvent.EventRecord.CreditsDelta != 25 {
		t.Fatalf("expected shared metadata fallback values, got %#v", providerEvent.EventRecord)
	}
	if providerEvent.GrantEvent == nil || providerEvent.GrantEvent.Metadata["user_email"] != "shared@example.com" {
		t.Fatalf("expected grant metadata to include fallback email, got %#v", providerEvent.GrantEvent)
	}
}

func TestPaddleSharedCheckoutAndPortalCoverage(t *testing.T) {
	t.Run("shared checkout success", func(t *testing.T) {
		var transactionBody string
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/customers":
				_, _ = io.WriteString(writer, `{"data":[{"id":"ctm_shared"}]}`)
			case request.Method == http.MethodPost && request.URL.Path == "/transactions":
				body, _ := io.ReadAll(request.Body)
				transactionBody = string(body)
				_, _ = io.WriteString(writer, `{"data":{"id":"txn_shared"}}`)
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			}
		}))
		defer server.Close()

		cfg := validBillingConfig()
		cfg.PaddleAPIBaseURL = server.URL
		provider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			t.Fatalf("newPaddleBillingProvider() error = %v", err)
		}

		session, err := provider.CreateCheckout(
			context.Background(),
			" shared-user ",
			" shared@example.com ",
			cfg.BillingPacks[0],
			"https://site.example.com/?billing_transaction_id="+checkoutTransactionIDPlaceholder,
		)
		if err != nil {
			t.Fatalf("CreateCheckout(shared) error = %v", err)
		}
		if session.TransactionID != "txn_shared" {
			t.Fatalf("unexpected shared checkout session %#v", session)
		}
		if !strings.Contains(transactionBody, `"billing_subject_id":"shared-user"`) || !strings.Contains(transactionBody, `"crossword_user_id":"shared-user"`) {
			t.Fatalf("expected shared transaction metadata to include subject id, got %s", transactionBody)
		}
		if !strings.Contains(transactionBody, `"billing_user_email":"shared@example.com"`) || !strings.Contains(transactionBody, `"user_email":"shared@example.com"`) {
			t.Fatalf("expected shared transaction metadata to include normalized email, got %s", transactionBody)
		}
		if !strings.Contains(session.CheckoutURL, "/pay.html?") || !strings.Contains(session.CheckoutURL, "transaction_id=txn_shared") {
			t.Fatalf("expected shared checkout url to target pay page, got %q", session.CheckoutURL)
		}
		if !strings.Contains(session.CheckoutURL, "return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_shared") {
			t.Fatalf("expected shared checkout url to include replaced return_to, got %q", session.CheckoutURL)
		}
	})

	t.Run("shared checkout error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/customers":
				_, _ = io.WriteString(writer, `{"data":[{"id":"ctm_shared"}]}`)
			case request.Method == http.MethodPost && request.URL.Path == "/transactions":
				writer.WriteHeader(http.StatusInternalServerError)
				_, _ = io.WriteString(writer, `{"error":{"detail":"shared checkout failed"}}`)
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			}
		}))
		defer server.Close()

		cfg := validBillingConfig()
		cfg.PaddleAPIBaseURL = server.URL
		provider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			t.Fatalf("newPaddleBillingProvider() error = %v", err)
		}

		_, err = provider.CreateCheckout(context.Background(), "user-1", "shared@example.com", cfg.BillingPacks[0], "https://site.example.com/return")
		if err == nil || !strings.Contains(err.Error(), "shared checkout failed") {
			t.Fatalf("expected shared checkout error, got %v", err)
		}
	})

	t.Run("configured provider portal success", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch {
			case request.Method == http.MethodPost && request.URL.Path == "/customers/ctm_shared/portal-sessions":
				_, _ = io.WriteString(writer, `{"data":{"urls":{"general":{"overview":"https://portal.example.com/shared"}}}}`)
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			}
		}))
		defer server.Close()

		cfg := validBillingConfig()
		cfg.PaddleAPIBaseURL = server.URL
		provider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			t.Fatalf("newPaddleBillingProvider() error = %v", err)
		}

		portalSession, err := provider.CreatePortalSession(context.Background(), BillingCustomerLink{PaddleCustomerID: "ctm_shared"})
		if err != nil {
			t.Fatalf("CreatePortalSession(configured) error = %v", err)
		}
		if portalSession.URL != "https://portal.example.com/shared" {
			t.Fatalf("unexpected configured portal session %#v", portalSession)
		}
	})

	t.Run("configured provider portal error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			switch {
			case request.Method == http.MethodPost && request.URL.Path == "/customers/ctm_shared/portal-sessions":
				writer.WriteHeader(http.StatusInternalServerError)
				_, _ = io.WriteString(writer, `{"error":{"detail":"shared portal failed"}}`)
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			}
		}))
		defer server.Close()

		cfg := validBillingConfig()
		cfg.PaddleAPIBaseURL = server.URL
		provider, err := newPaddleBillingProvider(cfg)
		if err != nil {
			t.Fatalf("newPaddleBillingProvider() error = %v", err)
		}

		_, err = provider.CreatePortalSession(context.Background(), BillingCustomerLink{PaddleCustomerID: "ctm_shared"})
		if err == nil || !strings.Contains(err.Error(), "shared portal failed") {
			t.Fatalf("expected configured portal error, got %v", err)
		}
	})
}

func TestBuildPayPageCheckoutURLCoverage(t *testing.T) {
	if got := buildPayPageCheckoutURL(" ", " "); got != "/pay.html" {
		t.Fatalf("expected blank pay page checkout url, got %q", got)
	}

	got := buildPayPageCheckoutURL(" txn_123 ", "https://site.example.com/?billing_transaction_id="+checkoutTransactionIDPlaceholder)
	if !strings.HasPrefix(got, "/pay.html?") {
		t.Fatalf("expected pay page path with query, got %q", got)
	}
	if !strings.Contains(got, "transaction_id=txn_123") {
		t.Fatalf("expected transaction id query parameter, got %q", got)
	}
	if !strings.Contains(got, "return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_123") {
		t.Fatalf("expected replaced return_to query parameter, got %q", got)
	}
}

func TestAppendCheckoutReturnURLCoverage(t *testing.T) {
	if got := appendCheckoutReturnURL("", "https://site.example.com"); got != "" {
		t.Fatalf("expected blank checkout url to stay blank, got %q", got)
	}
	if got := appendCheckoutReturnURL("https://checkout.example.com", "   "); got != "https://checkout.example.com" {
		t.Fatalf("expected blank return url to keep checkout url, got %q", got)
	}
	if got := appendCheckoutReturnURL("://bad-url", "https://site.example.com"); got != "://bad-url" {
		t.Fatalf("expected invalid checkout url to pass through, got %q", got)
	}
	got := appendCheckoutReturnURL("https://checkout.example.com/session?existing=1", "https://site.example.com/return")
	if !strings.Contains(got, "return_to=https%3A%2F%2Fsite.example.com%2Freturn") {
		t.Fatalf("expected checkout url to include return_to, got %q", got)
	}
}

func TestReplaceCheckoutTransactionPlaceholderCoverage(t *testing.T) {
	returnURL := "https://site.example.com/?billing_transaction_id=" + checkoutTransactionIDPlaceholder
	if got := replaceCheckoutTransactionPlaceholder(returnURL, " txn_123 "); got != "https://site.example.com/?billing_transaction_id=txn_123" {
		t.Fatalf("expected placeholder replacement, got %q", got)
	}
	checkoutURL := "https://checkout.example.com/session?return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3D%7Btransaction_id%7D"
	if got := replaceCheckoutTransactionPlaceholder(checkoutURL, " txn_123 "); got != "https://checkout.example.com/session?return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_123" {
		t.Fatalf("expected encoded placeholder replacement, got %q", got)
	}
	if got := replaceCheckoutTransactionPlaceholder(returnURL, "   "); got != returnURL {
		t.Fatalf("expected blank transaction id to keep return url, got %q", got)
	}
}

func TestPaddleProviderAndClientCheckoutCoverage(t *testing.T) {
	t.Run("provider checkout success and portal success", func(t *testing.T) {
		var createCustomerCalls int
		var createTransactionBody string

		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/customers":
				if request.URL.Query().Get("email") == "existing@example.com" {
					return jsonHTTPResponse(http.StatusOK, `{"data":[{"id":"ctm_existing","email":"existing@example.com"}]}`), nil
				}
				return jsonHTTPResponse(http.StatusOK, `{"data":[]}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/customers":
				createCustomerCalls++
				return jsonHTTPResponse(http.StatusOK, `{"data":{"id":"ctm_new","email":"new@example.com"}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/transactions":
				body, _ := io.ReadAll(request.Body)
				createTransactionBody = string(body)
				return jsonHTTPResponse(http.StatusOK, `{"data":{"id":"txn_123"}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/transactions/txn_123":
				return jsonHTTPResponse(http.StatusOK, `{"data":{"checkout":{"url":"https://checkout.example.com/session"}}}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/customers/ctm_new/portal-sessions":
				return jsonHTTPResponse(http.StatusOK, `{"data":{"urls":{"general":{"overview":"https://portal.example.com"}}}}`), nil
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
				return nil, nil
			}
		})

		provider := newTestPaddleProvider(client)

		existingCustomerID, err := client.ResolveCustomerID(context.Background(), "existing@example.com")
		if err != nil {
			t.Fatalf("ResolveCustomerID(existing) error = %v", err)
		}
		if existingCustomerID != "ctm_existing" {
			t.Fatalf("unexpected existing customer id %q", existingCustomerID)
		}

		checkoutSession, err := provider.CreateCheckout(
			context.Background(),
			"user-123",
			"new@example.com",
			provider.cfg.BillingPacks[0],
			"https://site.example.com/?billing_transaction_id="+checkoutTransactionIDPlaceholder,
		)
		if err != nil {
			t.Fatalf("CreateCheckout() error = %v", err)
		}
		if checkoutSession.TransactionID != "txn_123" {
			t.Fatalf("unexpected checkout session %#v", checkoutSession)
		}
		if strings.Contains(checkoutSession.CheckoutURL, "%7Btransaction_id%7D") {
			t.Fatalf("expected checkout url to resolve the transaction placeholder, got %q", checkoutSession.CheckoutURL)
		}
		if !strings.Contains(checkoutSession.CheckoutURL, "return_to=https%3A%2F%2Fsite.example.com%2F%3Fbilling_transaction_id%3Dtxn_123") {
			t.Fatalf("expected checkout url to include return_to, got %q", checkoutSession.CheckoutURL)
		}
		if createCustomerCalls != 1 {
			t.Fatalf("expected one created customer, got %d", createCustomerCalls)
		}
		if !strings.Contains(createTransactionBody, `"price_id":"pri_test_starter"`) {
			t.Fatalf("expected create transaction payload to include price id, got %s", createTransactionBody)
		}

		portalSession, err := provider.CreatePortalSession(context.Background(), BillingCustomerLink{PaddleCustomerID: "ctm_new"})
		if err != nil {
			t.Fatalf("CreatePortalSession() error = %v", err)
		}
		if portalSession.URL != "https://portal.example.com" {
			t.Fatalf("unexpected portal session %#v", portalSession)
		}
	})

	t.Run("provider checkout returns resolver error", func(t *testing.T) {
		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusInternalServerError, `{"error":{"detail":"customer lookup failed"}}`), nil
		})
		provider := newTestPaddleProvider(client)

		_, err := provider.CreateCheckout(context.Background(), "user-123", "new@example.com", provider.cfg.BillingPacks[0], "https://site.example.com/return")
		if err == nil || !strings.Contains(err.Error(), "customer lookup failed") {
			t.Fatalf("expected resolver error, got %v", err)
		}
	})

	t.Run("provider checkout returns transaction error", func(t *testing.T) {
		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/customers":
				return jsonHTTPResponse(http.StatusOK, `{"data":[{"id":"ctm_existing"}]}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/transactions":
				return jsonHTTPResponse(http.StatusInternalServerError, `{"error":{"detail":"transaction create failed"}}`), nil
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
				return nil, nil
			}
		})
		provider := newTestPaddleProvider(client)

		_, err := provider.CreateCheckout(context.Background(), "user-123", "existing@example.com", provider.cfg.BillingPacks[0], "https://site.example.com/return")
		if err == nil || !strings.Contains(err.Error(), "transaction create failed") {
			t.Fatalf("expected transaction creation error, got %v", err)
		}
	})

	t.Run("provider checkout returns checkout url error", func(t *testing.T) {
		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			switch {
			case request.Method == http.MethodGet && request.URL.Path == "/customers":
				return jsonHTTPResponse(http.StatusOK, `{"data":[{"id":"ctm_existing"}]}`), nil
			case request.Method == http.MethodPost && request.URL.Path == "/transactions":
				return jsonHTTPResponse(http.StatusOK, `{"data":{"id":"txn_123"}}`), nil
			case request.Method == http.MethodGet && request.URL.Path == "/transactions/txn_123":
				return jsonHTTPResponse(http.StatusOK, `{"data":{"checkout":{"url":""}}}`), nil
			default:
				t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
				return nil, nil
			}
		})
		provider := newTestPaddleProvider(client)

		_, err := provider.CreateCheckout(context.Background(), "user-123", "existing@example.com", provider.cfg.BillingPacks[0], "https://site.example.com/return")
		if !errors.Is(err, ErrPaddleCheckoutURLMissing) {
			t.Fatalf("expected missing checkout url error, got %v", err)
		}
	})

	t.Run("provider portal returns client error", func(t *testing.T) {
		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusInternalServerError, `{"error":{"detail":"portal failed"}}`), nil
		})
		provider := newTestPaddleProvider(client)

		_, err := provider.CreatePortalSession(context.Background(), BillingCustomerLink{PaddleCustomerID: "ctm_123"})
		if err == nil || !strings.Contains(err.Error(), "portal failed") {
			t.Fatalf("expected portal creation error, got %v", err)
		}
	})

	t.Run("provider portal guards", func(t *testing.T) {
		if _, err := (*paddleBillingProvider)(nil).CreatePortalSession(context.Background(), BillingCustomerLink{}); !errors.Is(err, ErrBillingPortalUnavailable) {
			t.Fatalf("expected nil provider to reject portal session, got %v", err)
		}

		noClientProvider := &paddleBillingProvider{}
		if _, err := noClientProvider.CreatePortalSession(context.Background(), BillingCustomerLink{PaddleCustomerID: "ctm_123"}); !errors.Is(err, ErrBillingPortalUnavailable) {
			t.Fatalf("expected missing api client to reject portal session, got %v", err)
		}

		missingCustomerIDProvider := newTestPaddleProvider(newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			t.Fatalf("unexpected request %s %s", request.Method, request.URL.String())
			return nil, nil
		}))
		if _, err := missingCustomerIDProvider.CreatePortalSession(context.Background(), BillingCustomerLink{}); !errors.Is(err, ErrBillingPortalUnavailable) {
			t.Fatalf("expected missing customer id to reject portal session, got %v", err)
		}
	})
}

func TestPaddleAPIClientDirectMethodCoverage(t *testing.T) {
	t.Run("find customer by email covers empty and found results", func(t *testing.T) {
		client := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			if request.URL.Query().Get("email") == "missing@example.com" {
				return jsonHTTPResponse(http.StatusOK, `{"data":[]}`), nil
			}
			return jsonHTTPResponse(http.StatusOK, `{"data":[{"id":"ctm_found"}]}`), nil
		})

		customerID, err := client.findCustomerIDByEmail(context.Background(), "missing@example.com")
		if err != nil {
			t.Fatalf("findCustomerIDByEmail(missing) error = %v", err)
		}
		if customerID != "" {
			t.Fatalf("expected missing customer to return empty id, got %q", customerID)
		}

		customerID, err = client.findCustomerIDByEmail(context.Background(), "found@example.com")
		if err != nil {
			t.Fatalf("findCustomerIDByEmail(found) error = %v", err)
		}
		if customerID != "ctm_found" {
			t.Fatalf("unexpected found customer id %q", customerID)
		}
	})

	t.Run("create customer covers success and error", func(t *testing.T) {
		successClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusOK, `{"data":{"id":"ctm_created"}}`), nil
		})
		customerID, err := successClient.createCustomer(context.Background(), "created@example.com")
		if err != nil {
			t.Fatalf("createCustomer(success) error = %v", err)
		}
		if customerID != "ctm_created" {
			t.Fatalf("unexpected created customer id %q", customerID)
		}

		errorClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return nil, errors.New("network down")
		})
		if _, err := errorClient.createCustomer(context.Background(), "created@example.com"); err == nil || !strings.Contains(err.Error(), "network down") {
			t.Fatalf("expected createCustomer() to return transport error, got %v", err)
		}
	})

	t.Run("create transaction covers success and error", func(t *testing.T) {
		successClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusOK, `{"data":{"id":"txn_created"}}`), nil
		})
		transactionID, err := successClient.CreateTransaction(context.Background(), "ctm_123", "pri_test_starter", map[string]string{"foo": "bar"})
		if err != nil {
			t.Fatalf("CreateTransaction(success) error = %v", err)
		}
		if transactionID != "txn_created" {
			t.Fatalf("unexpected transaction id %q", transactionID)
		}

		errorClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusInternalServerError, `{"error":{"detail":"create failed"}}`), nil
		})
		if _, err := errorClient.CreateTransaction(context.Background(), "ctm_123", "pri_test_starter", nil); err == nil || !strings.Contains(err.Error(), "create failed") {
			t.Fatalf("expected CreateTransaction() to return api error, got %v", err)
		}
	})

	t.Run("get transaction checkout url covers error and success", func(t *testing.T) {
		successClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusOK, `{"data":{"checkout":{"url":"https://checkout.example.com/success"}}}`), nil
		})
		checkoutURL, err := successClient.GetTransactionCheckoutURL(context.Background(), "txn_success")
		if err != nil {
			t.Fatalf("GetTransactionCheckoutURL(success) error = %v", err)
		}
		if checkoutURL != "https://checkout.example.com/success" {
			t.Fatalf("unexpected checkout url %q", checkoutURL)
		}

		missingClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusOK, `{"data":{"checkout":{"url":""}}}`), nil
		})
		if _, err := missingClient.GetTransactionCheckoutURL(context.Background(), "txn_missing"); !errors.Is(err, ErrPaddleCheckoutURLMissing) {
			t.Fatalf("expected missing checkout url error, got %v", err)
		}

		errorClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return nil, errors.New("lookup failed")
		})
		if _, err := errorClient.GetTransactionCheckoutURL(context.Background(), "txn_error"); err == nil || !strings.Contains(err.Error(), "lookup failed") {
			t.Fatalf("expected transport error, got %v", err)
		}
	})

	t.Run("client portal session covers success and error", func(t *testing.T) {
		successClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return jsonHTTPResponse(http.StatusOK, `{"data":{"urls":{"general":{"overview":"https://portal.example.com/overview"}}}}`), nil
		})
		portalURL, err := successClient.CreatePortalSession(context.Background(), "ctm_123")
		if err != nil {
			t.Fatalf("CreatePortalSession(success) error = %v", err)
		}
		if portalURL != "https://portal.example.com/overview" {
			t.Fatalf("unexpected portal url %q", portalURL)
		}

		errorClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
			return nil, errors.New("portal transport failed")
		})
		if _, err := errorClient.CreatePortalSession(context.Background(), "ctm_123"); err == nil || !strings.Contains(err.Error(), "portal transport failed") {
			t.Fatalf("expected portal transport error, got %v", err)
		}
	})
}

func TestPaddleDoJSONRequestCoverage(t *testing.T) {
	marshalClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		t.Fatal("transport should not be called when marshaling fails")
		return nil, nil
	})
	if err := marshalClient.doJSONRequest(context.Background(), http.MethodPost, "/customers", map[string]interface{}{"bad": make(chan int)}, nil); err == nil {
		t.Fatal("expected marshal error")
	}

	invalidURLClient := &paddleAPIClient{
		apiKey:     "test_api_key",
		baseURL:    "://bad-url",
		httpClient: &http.Client{},
	}
	if err := invalidURLClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, nil); err == nil {
		t.Fatal("expected request construction error")
	}

	transportClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return nil, errors.New("transport failed")
	})
	if err := transportClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, nil); err == nil || !strings.Contains(err.Error(), "transport failed") {
		t.Fatalf("expected transport error, got %v", err)
	}

	checkoutMissingClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusBadRequest, `{"error":{"code":"transaction_default_checkout_url_not_set"}}`), nil
	})
	if err := checkoutMissingClient.doJSONRequest(context.Background(), http.MethodGet, "/transactions/txn_123", nil, nil); !errors.Is(err, ErrPaddleCheckoutURLMissing) {
		t.Fatalf("expected checkout missing code error, got %v", err)
	}

	detailClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusBadRequest, `{"error":{"detail":"detailed failure"}}`), nil
	})
	if err := detailClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, nil); err == nil || !strings.Contains(err.Error(), "detailed failure") {
		t.Fatalf("expected detailed api error, got %v", err)
	}

	statusClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusInternalServerError, `{"error":{}}`), nil
	})
	if err := statusClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, nil); err == nil || !strings.Contains(err.Error(), "status 500") {
		t.Fatalf("expected generic status error, got %v", err)
	}

	nilResponseClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusOK, `{}`), nil
	})
	if err := nilResponseClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, nil); err != nil {
		t.Fatalf("expected nil response payload request to succeed, got %v", err)
	}

	decodeClient := newTestPaddleAPIClient(func(request *http.Request) (*http.Response, error) {
		return jsonHTTPResponse(http.StatusOK, `{`), nil
	})
	var responsePayload struct{}
	if err := decodeClient.doJSONRequest(context.Background(), http.MethodGet, "/customers", nil, &responsePayload); err == nil {
		t.Fatal("expected decode error")
	}
}
