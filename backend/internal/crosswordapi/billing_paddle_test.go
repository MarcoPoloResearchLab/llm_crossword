package crosswordapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"testing"
	"time"
)

func TestPaddleBillingProviderVerifyWebhookSignature(t *testing.T) {
	cfg := validBillingConfig()
	cfg.PaddleWebhookSecret = "pdl_secret_test"

	provider, err := newPaddleBillingProvider(cfg)
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}

	payload := []byte(`{"event_id":"evt_123"}`)
	timestamp := time.Now().UTC().Unix()
	mac := hmac.New(sha256.New, []byte(cfg.PaddleWebhookSecret))
	_, _ = mac.Write([]byte(fmt.Sprintf("%d:%s", timestamp, payload)))
	signature := hex.EncodeToString(mac.Sum(nil))
	header := fmt.Sprintf("ts=%d;h1=%s", timestamp, signature)

	if err := provider.VerifyWebhookSignature(header, payload); err != nil {
		t.Fatalf("VerifyWebhookSignature() error = %v", err)
	}
	if err := provider.VerifyWebhookSignature(fmt.Sprintf("ts=%d;h1=deadbeef", timestamp), payload); err == nil {
		t.Fatal("expected invalid signature error")
	}
}

func TestPaddleBillingProviderParseWebhookEvent(t *testing.T) {
	provider, err := newPaddleBillingProvider(validBillingConfig())
	if err != nil {
		t.Fatalf("newPaddleBillingProvider() error = %v", err)
	}

	payload := []byte(`{
	  "event_id": "evt_123",
	  "event_type": "transaction.completed",
	  "occurred_at": "2026-03-28T18:40:00Z",
	  "data": {
	    "id": "txn_123",
	    "status": "completed",
	    "customer_id": "ctm_123",
	    "customer": {
	      "email": "user@example.com"
	    },
	    "custom_data": {
	      "crossword_user_id": "user-123",
	      "user_email": "user@example.com",
	      "pack_code": "starter",
	      "credits": "20"
	    },
	    "items": [
	      {
	        "price": { "id": "pri_test_starter" }
	      }
	    ]
	  }
	}`)

	providerEvent, err := provider.ParseWebhookEvent(payload)
	if err != nil {
		t.Fatalf("ParseWebhookEvent() error = %v", err)
	}
	if providerEvent.EventRecord.TransactionID != "txn_123" {
		t.Fatalf("unexpected transaction id %q", providerEvent.EventRecord.TransactionID)
	}
	if providerEvent.EventRecord.CreditsDelta != 20 {
		t.Fatalf("unexpected credits delta %d", providerEvent.EventRecord.CreditsDelta)
	}
	if providerEvent.CustomerLink == nil || providerEvent.CustomerLink.PaddleCustomerID != "ctm_123" {
		t.Fatalf("unexpected customer link %#v", providerEvent.CustomerLink)
	}
	if providerEvent.GrantEvent == nil {
		t.Fatal("expected grant event for completed transaction")
	}
	if providerEvent.GrantEvent.Provider != billingProviderPaddle {
		t.Fatalf("unexpected grant provider %q", providerEvent.GrantEvent.Provider)
	}
	if providerEvent.GrantEvent.Metadata["billing_pack_code"] != "starter" {
		t.Fatalf("unexpected grant metadata %#v", providerEvent.GrantEvent.Metadata)
	}
}
