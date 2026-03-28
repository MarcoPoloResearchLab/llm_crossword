package crosswordapi

import (
	"fmt"
	"os"
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
	DatabaseDSN       string
	AdminEmails       []string
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
	if strings.TrimSpace(cfg.DatabaseDSN) == "" {
		cfg.DatabaseDSN = "crosswords.db"
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

// ParseAdminEmails splits comma-delimited emails into a normalized slice.
func ParseAdminEmails(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return []string{}
	}
	parts := strings.Split(raw, ",")
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.ToLower(strings.TrimSpace(part))
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized
}

// ParseAdminEmailsFromYAML extracts administrators from the shared UI config.yaml.
func ParseAdminEmailsFromYAML(yamlText string) []string {
	if strings.TrimSpace(yamlText) == "" {
		return []string{}
	}

	adminEmails := make([]string, 0)
	lines := strings.Split(yamlText, "\n")
	inAdministrators := false

	for _, rawLine := range lines {
		line := strings.TrimRight(rawLine, "\r")
		trimmedLine := strings.TrimSpace(line)
		isIndented := len(line) > 0 && (line[0] == ' ' || line[0] == '\t')

		if !inAdministrators {
			if strings.HasPrefix(trimmedLine, "administrators:") {
				inAdministrators = true
			}
			continue
		}

		if trimmedLine == "" || strings.HasPrefix(trimmedLine, "#") {
			continue
		}
		if !isIndented {
			break
		}
		if !strings.HasPrefix(trimmedLine, "-") {
			continue
		}

		emailValue := strings.TrimSpace(strings.TrimPrefix(trimmedLine, "-"))
		emailValue = strings.Trim(emailValue, `"'`)
		if emailValue == "" {
			continue
		}
		adminEmails = append(adminEmails, emailValue)
	}

	return ParseAdminEmails(strings.Join(adminEmails, ","))
}

// LoadAdminEmailsFromYAMLFile reads and parses administrators from a YAML file.
func LoadAdminEmailsFromYAMLFile(path string) ([]string, error) {
	yamlBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return ParseAdminEmailsFromYAML(string(yamlBytes)), nil
}

// MergeAdminEmails combines multiple admin-email lists into one normalized set.
func MergeAdminEmails(emailLists ...[]string) []string {
	merged := make([]string, 0)
	seen := make(map[string]struct{})

	for _, emailList := range emailLists {
		for _, email := range emailList {
			normalizedEmail := strings.ToLower(strings.TrimSpace(email))
			if normalizedEmail == "" {
				continue
			}
			if _, exists := seen[normalizedEmail]; exists {
				continue
			}
			seen[normalizedEmail] = struct{}{}
			merged = append(merged, normalizedEmail)
		}
	}

	return merged
}

// IsAdmin returns true if the given email is in the admin list.
func (cfg *Config) IsAdmin(email string) bool {
	trimmed := strings.ToLower(strings.TrimSpace(email))
	if trimmed == "" {
		return false
	}
	for _, admin := range cfg.AdminEmails {
		if admin == trimmed {
			return true
		}
	}
	return false
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
