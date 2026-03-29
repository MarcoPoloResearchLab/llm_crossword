package crosswordapi

import (
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	defaultCoinValueCents            int64 = 100
	defaultBootstrapCoins            int64 = 30
	defaultGenerateCoins             int64 = 4
	defaultDailyLoginCoins           int64 = 8
	defaultLowBalanceFloorCoins      int64 = 4
	defaultOwnerSolveCoins           int64 = 3
	defaultOwnerNoHintBonusCoins     int64 = 1
	defaultOwnerDailySolveBonusCoins int64 = 1
	defaultOwnerDailySolveBonusLimit int64 = 3
	defaultCreatorSharedSolveCoins   int64 = 1
	defaultCreatorSharedPerPuzzleCap int64 = 10
	defaultCreatorSharedDailyCap     int64 = 20
)

// Config aggregates runtime settings for the crossword API.
type Config struct {
	ListenAddr                string
	LedgerAddress             string
	LedgerInsecure            bool
	LedgerTimeout             time.Duration
	DefaultTenantID           string
	DefaultLedgerID           string
	AllowedOrigins            []string
	SessionSigningKey         string
	SessionIssuer             string
	SessionCookieName         string
	TAuthBaseURL              string
	LLMProxyURL               string
	LLMProxyKey               string
	LLMProxyTimeout           time.Duration
	DatabaseDSN               string
	AdminEmails               []string
	CoinValueCents            int64
	BootstrapCoins            int64
	GenerateCoins             int64
	DailyLoginCoins           int64
	LowBalanceFloorCoins      int64
	OwnerSolveCoins           int64
	OwnerNoHintBonusCoins     int64
	OwnerDailySolveBonusCoins int64
	OwnerDailySolveBonusLimit int64
	CreatorSharedSolveCoins   int64
	CreatorSharedPerPuzzleCap int64
	CreatorSharedDailyCap     int64
	BillingProvider           string
	BillingPacks              []BillingPack
	PaddleEnvironment         string
	PaddleAPIKey              string
	PaddleAPIBaseURL          string
	PaddleClientToken         string
	PaddleWebhookSecret       string
	PaddlePackPriceIDs        map[string]string
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
	if cfg.CoinValueCents <= 0 {
		cfg.CoinValueCents = defaultCoinValueCents
	}
	if cfg.BootstrapCoins <= 0 {
		cfg.BootstrapCoins = defaultBootstrapCoins
	}
	if cfg.GenerateCoins <= 0 {
		cfg.GenerateCoins = defaultGenerateCoins
	}
	if cfg.DailyLoginCoins <= 0 {
		cfg.DailyLoginCoins = defaultDailyLoginCoins
	}
	if cfg.LowBalanceFloorCoins <= 0 {
		cfg.LowBalanceFloorCoins = defaultLowBalanceFloorCoins
	}
	if cfg.OwnerSolveCoins <= 0 {
		cfg.OwnerSolveCoins = defaultOwnerSolveCoins
	}
	if cfg.OwnerNoHintBonusCoins <= 0 {
		cfg.OwnerNoHintBonusCoins = defaultOwnerNoHintBonusCoins
	}
	if cfg.OwnerDailySolveBonusCoins <= 0 {
		cfg.OwnerDailySolveBonusCoins = defaultOwnerDailySolveBonusCoins
	}
	if cfg.OwnerDailySolveBonusLimit <= 0 {
		cfg.OwnerDailySolveBonusLimit = defaultOwnerDailySolveBonusLimit
	}
	if cfg.CreatorSharedSolveCoins <= 0 {
		cfg.CreatorSharedSolveCoins = defaultCreatorSharedSolveCoins
	}
	if cfg.CreatorSharedPerPuzzleCap <= 0 {
		cfg.CreatorSharedPerPuzzleCap = defaultCreatorSharedPerPuzzleCap
	}
	if cfg.CreatorSharedDailyCap <= 0 {
		cfg.CreatorSharedDailyCap = defaultCreatorSharedDailyCap
	}
	if err := cfg.validateBilling(); err != nil {
		return err
	}
	return nil
}

func (cfg Config) validateBilling() error {
	providerCode := strings.ToLower(strings.TrimSpace(cfg.BillingProvider))
	if providerCode == "" {
		return nil
	}
	if providerCode != billingProviderPaddle {
		return fmt.Errorf("billing provider %q is not supported", providerCode)
	}

	packCodes := make(map[string]struct{}, len(cfg.BillingPacks))
	if len(cfg.BillingPacks) == 0 {
		return fmt.Errorf("billing packs are required when billing provider is enabled")
	}
	for _, rawPack := range cfg.BillingPacks {
		pack := cloneBillingPack(rawPack)
		if pack.Code == "" {
			return fmt.Errorf("billing pack code is required")
		}
		if pack.Label == "" {
			return fmt.Errorf("billing pack label is required for %s", pack.Code)
		}
		if pack.Credits <= 0 {
			return fmt.Errorf("billing pack credits must be positive for %s", pack.Code)
		}
		if pack.PriceCents <= 0 {
			return fmt.Errorf("billing pack price_cents must be positive for %s", pack.Code)
		}
		if _, exists := packCodes[pack.Code]; exists {
			return fmt.Errorf("billing pack %s is duplicated", pack.Code)
		}
		packCodes[pack.Code] = struct{}{}
	}

	environment := strings.ToLower(strings.TrimSpace(cfg.PaddleEnvironment))
	switch environment {
	case paddleEnvironmentSandbox, paddleEnvironmentProduction:
	default:
		return fmt.Errorf("paddle environment must be %q or %q", paddleEnvironmentSandbox, paddleEnvironmentProduction)
	}
	if strings.TrimSpace(cfg.PaddleAPIKey) == "" {
		return fmt.Errorf("paddle api key is required")
	}
	if strings.TrimSpace(cfg.PaddleClientToken) == "" {
		return fmt.Errorf("paddle client token is required")
	}
	if strings.TrimSpace(cfg.PaddleWebhookSecret) == "" {
		return fmt.Errorf("paddle webhook secret is required")
	}
	for packCode := range packCodes {
		if strings.TrimSpace(cfg.PaddlePackPriceIDs[packCode]) == "" {
			return fmt.Errorf("paddle price id is required for billing pack %s", packCode)
		}
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

func (cfg Config) BillingEnabled() bool {
	return strings.TrimSpace(cfg.BillingProvider) != ""
}

func (cfg Config) BillingPublicConfig() billingPublicConfig {
	return billingPublicConfig{
		Environment: strings.ToLower(strings.TrimSpace(cfg.PaddleEnvironment)),
		ClientToken: strings.TrimSpace(cfg.PaddleClientToken),
	}
}

func (cfg Config) NormalizedBillingPacks() []BillingPack {
	packs := make([]BillingPack, 0, len(cfg.BillingPacks))
	for _, pack := range cfg.BillingPacks {
		normalizedPack := cloneBillingPack(pack)
		if normalizedPack.Code == "" {
			continue
		}
		packs = append(packs, normalizedPack)
	}
	return packs
}

func (cfg Config) FindBillingPack(rawPackCode string) (BillingPack, bool) {
	packCode := normalizeBillingPackCode(rawPackCode)
	if packCode == "" {
		return BillingPack{}, false
	}
	for _, pack := range cfg.NormalizedBillingPacks() {
		if pack.Code == packCode {
			return pack, true
		}
	}
	return BillingPack{}, false
}

// BootstrapAmountCents returns the default bootstrap amount in cents.
func BootstrapAmountCents() int64 {
	return defaultBootstrapCoins * defaultCoinValueCents
}

// GenerateAmountCents returns the per-generation spend amount in cents.
func GenerateAmountCents() int64 {
	return defaultGenerateCoins * defaultCoinValueCents
}

// CoinValueCents exposes the cents-per-coin conversion.
func CoinValueCents() int64 {
	return defaultCoinValueCents
}

// BootstrapAmountCents returns the configured bootstrap amount in cents.
func (cfg Config) BootstrapAmountCents() int64 {
	return cfg.BootstrapCoins * cfg.CoinValueCents
}

// GenerateAmountCents returns the configured generation spend amount in cents.
func (cfg Config) GenerateAmountCents() int64 {
	return cfg.GenerateCoins * cfg.CoinValueCents
}

// DailyLoginAmountCents returns the configured daily login grant amount in cents.
func (cfg Config) DailyLoginAmountCents() int64 {
	return cfg.DailyLoginCoins * cfg.CoinValueCents
}

// OwnerSolveAmountCents returns the configured base owner solve reward in cents.
func (cfg Config) OwnerSolveAmountCents() int64 {
	return cfg.OwnerSolveCoins * cfg.CoinValueCents
}

// OwnerNoHintBonusAmountCents returns the configured no-hint bonus in cents.
func (cfg Config) OwnerNoHintBonusAmountCents() int64 {
	return cfg.OwnerNoHintBonusCoins * cfg.CoinValueCents
}

// OwnerDailySolveBonusAmountCents returns the configured daily solve bonus in cents.
func (cfg Config) OwnerDailySolveBonusAmountCents() int64 {
	return cfg.OwnerDailySolveBonusCoins * cfg.CoinValueCents
}

// CreatorSharedSolveAmountCents returns the configured creator shared-solve payout in cents.
func (cfg Config) CreatorSharedSolveAmountCents() int64 {
	return cfg.CreatorSharedSolveCoins * cfg.CoinValueCents
}
