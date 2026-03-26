package crosswordapi

import (
	"fmt"
	"strings"
	"time"
)

const (
	coinValueCents int64 = 100
	bootstrapCoins int64 = 20
	generateCoins  int64 = 5
)

// Config aggregates runtime settings for the crossword API.
type Config struct {
	ListenAddr        string
	LedgerAddress     string
	LedgerInsecure    bool
	LedgerTimeout     time.Duration
	DefaultTenantID   string
	DefaultLedgerID   string
	AllowedOrigins    []string
	SessionSigningKey string
	SessionIssuer     string
	SessionCookieName string
	TAuthBaseURL      string
	LLMProxyURL       string
	LLMProxyKey       string
	LLMProxyTimeout   time.Duration
}

// Validate ensures the configuration contains sane values.
func (cfg *Config) Validate() error {
	if strings.TrimSpace(cfg.ListenAddr) == "" {
		return fmt.Errorf("listen addr is required")
	}
	if strings.TrimSpace(cfg.LedgerAddress) == "" {
		return fmt.Errorf("ledger address is required")
	}
	if cfg.LedgerTimeout <= 0 {
		return fmt.Errorf("ledger timeout must be greater than zero")
	}
	if strings.TrimSpace(cfg.DefaultTenantID) == "" {
		return fmt.Errorf("default tenant id is required")
	}
	if strings.TrimSpace(cfg.DefaultLedgerID) == "" {
		return fmt.Errorf("default ledger id is required")
	}
	if len(cfg.AllowedOrigins) == 0 {
		return fmt.Errorf("at least one allowed origin is required")
	}
	if len(cfg.SessionSigningKey) == 0 {
		return fmt.Errorf("jwt signing key is required")
	}
	if strings.TrimSpace(cfg.SessionIssuer) == "" {
		return fmt.Errorf("jwt issuer is required")
	}
	if strings.TrimSpace(cfg.SessionCookieName) == "" {
		return fmt.Errorf("jwt cookie name is required")
	}
	if strings.TrimSpace(cfg.TAuthBaseURL) == "" {
		return fmt.Errorf("tauth base url is required")
	}
	if strings.TrimSpace(cfg.LLMProxyURL) == "" {
		return fmt.Errorf("llm proxy url is required")
	}
	if strings.TrimSpace(cfg.LLMProxyKey) == "" {
		return fmt.Errorf("llm proxy key is required")
	}
	if cfg.LLMProxyTimeout <= 0 {
		cfg.LLMProxyTimeout = 30 * time.Second
	}
	return nil
}

// ParseAllowedOrigins splits comma-delimited origins into a slice.
func ParseAllowedOrigins(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

// BootstrapAmountCents returns the default bootstrap amount in cents.
func BootstrapAmountCents() int64 {
	return bootstrapCoins * coinValueCents
}

// GenerateAmountCents returns the per-generation spend amount in cents.
func GenerateAmountCents() int64 {
	return generateCoins * coinValueCents
}

// CoinValueCents exposes the cents-per-coin conversion.
func CoinValueCents() int64 {
	return coinValueCents
}
