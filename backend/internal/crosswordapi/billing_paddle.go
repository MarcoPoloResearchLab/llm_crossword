package crosswordapi

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	paddleSignatureHeaderName = "Paddle-Signature"

	paddleAPIBaseURLSandbox    = "https://sandbox-api.paddle.com"
	paddleAPIBaseURLProduction = "https://api.paddle.com"

	paddleEventTypeTransactionCreated   = "transaction.created"
	paddleEventTypeTransactionUpdated   = "transaction.updated"
	paddleEventTypeTransactionCompleted = "transaction.completed"

	paddleMetadataUserIDKey    = "crossword_user_id"
	paddleMetadataUserEmailKey = "user_email"
	paddleMetadataPackCodeKey  = "pack_code"
	paddleMetadataCreditsKey   = "credits"

	paddleCollectionModeAutomatic = "automatic"
	paddleCheckoutURLMissingCode  = "transaction_default_checkout_url_not_set"

	paddleSignatureTimestampKey = "ts"
	paddleSignatureHashKey      = "h1"
)

var (
	ErrPaddleCheckoutURLMissing = errors.New("billing.paddle.checkout_url.missing")
	ErrPaddleWebhookSignature   = errors.New("billing.paddle.signature.invalid")
)

type paddleBillingProvider struct {
	apiClient  *paddleAPIClient
	cfg        Config
	packPrices map[string]string
}

type paddleCustomer struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

type paddleListCustomersResponse struct {
	Data []paddleCustomer `json:"data"`
}

type paddleCreateCustomerRequest struct {
	Email string `json:"email"`
}

type paddleCreateCustomerResponse struct {
	Data paddleCustomer `json:"data"`
}

type paddleCreateTransactionRequest struct {
	Items          []paddleCreateTransactionItem `json:"items"`
	CollectionMode string                        `json:"collection_mode"`
	CustomerID     string                        `json:"customer_id"`
	CustomData     map[string]string             `json:"custom_data,omitempty"`
}

type paddleCreateTransactionItem struct {
	PriceID  string `json:"price_id"`
	Quantity int    `json:"quantity"`
}

type paddleCreateTransactionResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

type paddleGetTransactionResponse struct {
	Data paddleTransactionPayload `json:"data"`
}

type paddleCreatePortalSessionResponse struct {
	Data struct {
		URLs struct {
			General struct {
				Overview string `json:"overview"`
			} `json:"general"`
		} `json:"urls"`
	} `json:"data"`
}

type paddleWebhookEnvelope struct {
	EventID    string                   `json:"event_id"`
	EventType  string                   `json:"event_type"`
	OccurredAt string                   `json:"occurred_at"`
	Data       paddleTransactionPayload `json:"data"`
}

type paddleTransactionPayload struct {
	ID         string                      `json:"id"`
	Status     string                      `json:"status"`
	CustomerID string                      `json:"customer_id"`
	Customer   paddleTransactionCustomer   `json:"customer"`
	CustomData map[string]interface{}      `json:"custom_data"`
	Items      []paddleTransactionLineItem `json:"items"`
	Checkout   struct {
		URL string `json:"url"`
	} `json:"checkout"`
}

type paddleTransactionCustomer struct {
	Email        string `json:"email"`
	EmailAddress string `json:"email_address"`
}

type paddleTransactionLineItem struct {
	PriceID string `json:"price_id"`
	Price   struct {
		ID string `json:"id"`
	} `json:"price"`
}

type paddleAPIClient struct {
	apiKey     string
	baseURL    string
	httpClient *http.Client
}

func newPaddleBillingProvider(cfg Config) (*paddleBillingProvider, error) {
	apiClient, err := newPaddleAPIClient(cfg.PaddleEnvironment, cfg.PaddleAPIKey, cfg.PaddleAPIBaseURL)
	if err != nil {
		return nil, err
	}

	packPrices := make(map[string]string, len(cfg.PaddlePackPriceIDs))
	for packCode, priceID := range cfg.PaddlePackPriceIDs {
		packPrices[normalizeBillingPackCode(packCode)] = strings.TrimSpace(priceID)
	}

	return &paddleBillingProvider{
		apiClient:  apiClient,
		cfg:        cfg,
		packPrices: packPrices,
	}, nil
}

func newPaddleAPIClient(environment string, apiKey string, baseURLOverride string) (*paddleAPIClient, error) {
	baseURL := strings.TrimSpace(baseURLOverride)
	if baseURL == "" {
		switch strings.ToLower(strings.TrimSpace(environment)) {
		case paddleEnvironmentSandbox:
			baseURL = paddleAPIBaseURLSandbox
		case paddleEnvironmentProduction:
			baseURL = paddleAPIBaseURLProduction
		default:
			return nil, fmt.Errorf("unsupported paddle environment %q", environment)
		}
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, fmt.Errorf("paddle api key is required")
	}
	return &paddleAPIClient{
		apiKey:     strings.TrimSpace(apiKey),
		baseURL:    strings.TrimRight(baseURL, "/"),
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

func (provider *paddleBillingProvider) Code() string {
	return billingProviderPaddle
}

func (provider *paddleBillingProvider) PublicConfig() billingPublicConfig {
	return provider.cfg.BillingPublicConfig()
}

func (provider *paddleBillingProvider) SignatureHeaderName() string {
	return paddleSignatureHeaderName
}

func (provider *paddleBillingProvider) VerifyWebhookSignature(signatureHeader string, payload []byte) error {
	timestamp, hashes, err := parsePaddleSignatureHeader(signatureHeader)
	if err != nil {
		return err
	}

	now := time.Now().UTC()
	eventTime := time.Unix(timestamp, 0).UTC()
	age := now.Sub(eventTime)
	if age < 0 {
		age = -age
	}
	if age > 5*time.Minute {
		return ErrPaddleWebhookSignature
	}

	mac := hmac.New(sha256.New, []byte(strings.TrimSpace(provider.cfg.PaddleWebhookSecret)))
	_, _ = mac.Write([]byte(strconv.FormatInt(timestamp, 10) + ":" + string(payload)))
	expectedHash := []byte(hex.EncodeToString(mac.Sum(nil)))
	for _, hashValue := range hashes {
		if subtle.ConstantTimeCompare(expectedHash, []byte(strings.ToLower(hashValue))) == 1 {
			return nil
		}
	}
	return ErrPaddleWebhookSignature
}

func parsePaddleSignatureHeader(signatureHeader string) (int64, []string, error) {
	trimmedHeader := strings.TrimSpace(signatureHeader)
	if trimmedHeader == "" {
		return 0, nil, ErrPaddleWebhookSignature
	}

	var timestamp int64
	hashes := make([]string, 0, 1)
	for _, segment := range strings.Split(trimmedHeader, ";") {
		key, value, ok := strings.Cut(strings.TrimSpace(segment), "=")
		if !ok {
			return 0, nil, ErrPaddleWebhookSignature
		}
		switch strings.TrimSpace(key) {
		case paddleSignatureTimestampKey:
			parsedTimestamp, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
			if err != nil {
				return 0, nil, ErrPaddleWebhookSignature
			}
			timestamp = parsedTimestamp
		case paddleSignatureHashKey:
			hashes = append(hashes, strings.TrimSpace(value))
		}
	}
	if timestamp == 0 || len(hashes) == 0 {
		return 0, nil, ErrPaddleWebhookSignature
	}
	return timestamp, hashes, nil
}

func (provider *paddleBillingProvider) ParseWebhookEvent(payload []byte) (billingProviderEvent, error) {
	envelope := paddleWebhookEnvelope{}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return billingProviderEvent{}, err
	}

	occurredAt, err := time.Parse(time.RFC3339, strings.TrimSpace(envelope.OccurredAt))
	if err != nil {
		return billingProviderEvent{}, err
	}

	userID := readPaddleMetadataValue(envelope.Data.CustomData, paddleMetadataUserIDKey)
	userEmail := readPaddleMetadataValue(envelope.Data.CustomData, paddleMetadataUserEmailKey)
	if userEmail == "" {
		userEmail = strings.TrimSpace(envelope.Data.Customer.Email)
	}
	if userEmail == "" {
		userEmail = strings.TrimSpace(envelope.Data.Customer.EmailAddress)
	}

	packCode := normalizeBillingPackCode(readPaddleMetadataValue(envelope.Data.CustomData, paddleMetadataPackCodeKey))
	priceID := resolvePaddlePriceID(envelope.Data.Items)
	credits := provider.resolveCredits(packCode, priceID, readPaddleMetadataValue(envelope.Data.CustomData, paddleMetadataCreditsKey))

	eventRecord := BillingEventRecord{
		Provider:         provider.Code(),
		EventID:          strings.TrimSpace(envelope.EventID),
		EventType:        strings.TrimSpace(envelope.EventType),
		UserID:           userID,
		UserEmail:        userEmail,
		PaddleCustomerID: strings.TrimSpace(envelope.Data.CustomerID),
		TransactionID:    strings.TrimSpace(envelope.Data.ID),
		PackCode:         packCode,
		CreditsDelta:     0,
		Status:           strings.TrimSpace(envelope.Data.Status),
		OccurredAt:       occurredAt.UTC(),
		RawPayloadSummary: fmt.Sprintf(
			"%s %s",
			strings.TrimSpace(envelope.EventType),
			strings.TrimSpace(envelope.Data.Status),
		),
	}

	providerEvent := billingProviderEvent{EventRecord: eventRecord}
	if eventRecord.EventType == paddleEventTypeTransactionCompleted && credits > 0 && strings.TrimSpace(userID) != "" {
		providerEvent.EventRecord.CreditsDelta = credits
		providerEvent.CustomerLink = &BillingCustomerLink{
			UserID:           userID,
			Provider:         provider.Code(),
			PaddleCustomerID: strings.TrimSpace(envelope.Data.CustomerID),
			Email:            strings.TrimSpace(userEmail),
		}
		providerEvent.GrantEvent = &BillingGrantEvent{
			User:       userID,
			Credits:    credits,
			Reference:  "paddle:credit_pack:" + strings.TrimSpace(envelope.Data.ID),
			ReasonCode: "billing_credit_pack",
			Metadata: map[string]string{
				"billing_provider":       "paddle",
				"billing_event_id":       strings.TrimSpace(envelope.EventID),
				"billing_event_type":     strings.TrimSpace(envelope.EventType),
				"billing_transaction_id": strings.TrimSpace(envelope.Data.ID),
				"billing_pack_code":      packCode,
				"billing_price_id":       priceID,
				"user_email":             strings.TrimSpace(userEmail),
			},
			Provider: provider.Code(),
			EventID:  strings.TrimSpace(envelope.EventID),
		}
	}

	return providerEvent, nil
}

func (provider *paddleBillingProvider) resolveCredits(packCode string, priceID string, metadataCredits string) int64 {
	if parsedCredits, err := strconv.ParseInt(strings.TrimSpace(metadataCredits), 10, 64); err == nil && parsedCredits > 0 {
		return parsedCredits
	}
	if pack, ok := provider.cfg.FindBillingPack(packCode); ok {
		return pack.Credits
	}
	for configuredPackCode, configuredPriceID := range provider.packPrices {
		if strings.TrimSpace(configuredPriceID) == strings.TrimSpace(priceID) {
			if pack, ok := provider.cfg.FindBillingPack(configuredPackCode); ok {
				return pack.Credits
			}
		}
	}
	return 0
}

func readPaddleMetadataValue(metadata map[string]interface{}, key string) string {
	if len(metadata) == 0 {
		return ""
	}
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}
	switch typedValue := value.(type) {
	case string:
		return strings.TrimSpace(typedValue)
	case float64:
		if typedValue == float64(int64(typedValue)) {
			return strconv.FormatInt(int64(typedValue), 10)
		}
		return strconv.FormatFloat(typedValue, 'f', -1, 64)
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typedValue))
	}
}

func resolvePaddlePriceID(items []paddleTransactionLineItem) string {
	for _, item := range items {
		if strings.TrimSpace(item.PriceID) != "" {
			return strings.TrimSpace(item.PriceID)
		}
		if strings.TrimSpace(item.Price.ID) != "" {
			return strings.TrimSpace(item.Price.ID)
		}
	}
	return ""
}

func (provider *paddleBillingProvider) CreateCheckout(ctx context.Context, userID string, userEmail string, pack BillingPack, returnURL string) (billingCheckoutSession, error) {
	customerID, err := provider.apiClient.ResolveCustomerID(ctx, userEmail)
	if err != nil {
		return billingCheckoutSession{}, err
	}

	priceID := strings.TrimSpace(provider.packPrices[pack.Code])
	transactionID, err := provider.apiClient.CreateTransaction(ctx, customerID, priceID, map[string]string{
		paddleMetadataUserIDKey:    strings.TrimSpace(userID),
		paddleMetadataUserEmailKey: strings.TrimSpace(userEmail),
		paddleMetadataPackCodeKey:  pack.Code,
		paddleMetadataCreditsKey:   strconv.FormatInt(pack.Credits, 10),
	})
	if err != nil {
		return billingCheckoutSession{}, err
	}

	checkoutURL, err := provider.apiClient.GetTransactionCheckoutURL(ctx, transactionID)
	if err != nil {
		return billingCheckoutSession{}, err
	}

	return billingCheckoutSession{
		ProviderCode:  provider.Code(),
		TransactionID: transactionID,
		CheckoutURL:   appendCheckoutReturnURL(checkoutURL, returnURL),
	}, nil
}

func (provider *paddleBillingProvider) CreatePortalSession(ctx context.Context, customerLink BillingCustomerLink) (billingPortalSession, error) {
	portalURL, err := provider.apiClient.CreatePortalSession(ctx, customerLink.PaddleCustomerID)
	if err != nil {
		return billingPortalSession{}, err
	}
	return billingPortalSession{
		ProviderCode: provider.Code(),
		URL:          portalURL,
	}, nil
}

func appendCheckoutReturnURL(checkoutURL string, returnURL string) string {
	if strings.TrimSpace(checkoutURL) == "" {
		return checkoutURL
	}
	if strings.TrimSpace(returnURL) == "" {
		return checkoutURL
	}

	parsedURL, err := url.Parse(checkoutURL)
	if err != nil {
		return checkoutURL
	}
	query := parsedURL.Query()
	query.Set("return_to", returnURL)
	parsedURL.RawQuery = query.Encode()
	return parsedURL.String()
}

func (client *paddleAPIClient) ResolveCustomerID(ctx context.Context, userEmail string) (string, error) {
	customerID, err := client.findCustomerIDByEmail(ctx, userEmail)
	if err != nil {
		return "", err
	}
	if customerID != "" {
		return customerID, nil
	}
	return client.createCustomer(ctx, userEmail)
}

func (client *paddleAPIClient) CreateTransaction(ctx context.Context, customerID string, priceID string, metadata map[string]string) (string, error) {
	requestPayload := paddleCreateTransactionRequest{
		Items: []paddleCreateTransactionItem{
			{
				PriceID:  strings.TrimSpace(priceID),
				Quantity: 1,
			},
		},
		CollectionMode: paddleCollectionModeAutomatic,
		CustomerID:     strings.TrimSpace(customerID),
		CustomData:     metadata,
	}

	responsePayload := paddleCreateTransactionResponse{}
	if err := client.doJSONRequest(ctx, http.MethodPost, "/transactions", requestPayload, &responsePayload); err != nil {
		return "", err
	}
	return strings.TrimSpace(responsePayload.Data.ID), nil
}

func (client *paddleAPIClient) GetTransactionCheckoutURL(ctx context.Context, transactionID string) (string, error) {
	responsePayload := paddleGetTransactionResponse{}
	path := "/transactions/" + url.PathEscape(strings.TrimSpace(transactionID))
	if err := client.doJSONRequest(ctx, http.MethodGet, path, nil, &responsePayload); err != nil {
		return "", err
	}
	checkoutURL := strings.TrimSpace(responsePayload.Data.Checkout.URL)
	if checkoutURL == "" {
		return "", ErrPaddleCheckoutURLMissing
	}
	return checkoutURL, nil
}

func (client *paddleAPIClient) CreatePortalSession(ctx context.Context, customerID string) (string, error) {
	responsePayload := paddleCreatePortalSessionResponse{}
	path := fmt.Sprintf("/customers/%s/portal-sessions", url.PathEscape(strings.TrimSpace(customerID)))
	if err := client.doJSONRequest(ctx, http.MethodPost, path, map[string]string{}, &responsePayload); err != nil {
		return "", err
	}
	return strings.TrimSpace(responsePayload.Data.URLs.General.Overview), nil
}

func (client *paddleAPIClient) findCustomerIDByEmail(ctx context.Context, userEmail string) (string, error) {
	query := url.Values{}
	query.Set("email", strings.TrimSpace(userEmail))
	responsePayload := paddleListCustomersResponse{}
	if err := client.doJSONRequest(ctx, http.MethodGet, "/customers?"+query.Encode(), nil, &responsePayload); err != nil {
		return "", err
	}
	if len(responsePayload.Data) == 0 {
		return "", nil
	}
	return strings.TrimSpace(responsePayload.Data[0].ID), nil
}

func (client *paddleAPIClient) createCustomer(ctx context.Context, userEmail string) (string, error) {
	responsePayload := paddleCreateCustomerResponse{}
	if err := client.doJSONRequest(ctx, http.MethodPost, "/customers", paddleCreateCustomerRequest{
		Email: strings.TrimSpace(userEmail),
	}, &responsePayload); err != nil {
		return "", err
	}
	return strings.TrimSpace(responsePayload.Data.ID), nil
}

func (client *paddleAPIClient) doJSONRequest(ctx context.Context, method string, path string, requestPayload interface{}, responsePayload interface{}) error {
	var body io.Reader
	if requestPayload != nil {
		requestBytes, err := json.Marshal(requestPayload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(requestBytes)
	}

	request, err := http.NewRequestWithContext(ctx, method, client.baseURL+path, body)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+client.apiKey)
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Paddle-Version", "1")
	if requestPayload != nil {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := client.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusBadRequest {
		responseBytes, _ := io.ReadAll(response.Body)
		var errorEnvelope struct {
			Error struct {
				Code   string `json:"code"`
				Detail string `json:"detail"`
			} `json:"error"`
		}
		_ = json.Unmarshal(responseBytes, &errorEnvelope)
		if strings.TrimSpace(errorEnvelope.Error.Code) == paddleCheckoutURLMissingCode {
			return ErrPaddleCheckoutURLMissing
		}
		if strings.TrimSpace(errorEnvelope.Error.Detail) != "" {
			return fmt.Errorf("paddle api error: %s", errorEnvelope.Error.Detail)
		}
		return fmt.Errorf("paddle api request failed with status %d", response.StatusCode)
	}

	if responsePayload == nil {
		return nil
	}
	return json.NewDecoder(response.Body).Decode(responsePayload)
}
