package crosswordapi

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func validConfig() Config {
	return Config{
		ListenAddr:        ":9090",
		LedgerAddress:     "localhost:50051",
		LedgerInsecure:    true,
		LedgerTimeout:     5 * time.Second,
		LedgerSecretKey:   "test-secret",
		DefaultTenantID:   "tenant-1",
		DefaultLedgerID:   "ledger-1",
		AllowedOrigins:    []string{"http://localhost:8000"},
		SessionSigningKey: "test-secret-key",
		SessionIssuer:     "tauth",
		SessionCookieName: "app_session",
		TAuthBaseURL:      "http://localhost:8080",
		LLMProxyURL:       "http://localhost:9999",
		LLMProxyKey:       "test-key",
		LLMProxyTimeout:   30 * time.Second,
	}
}

func validBillingConfig() Config {
	cfg := validConfig()
	cfg.BillingProvider = billingProviderPaddle
	cfg.CoinValueCents = defaultCoinValueCents
	cfg.BillingPacks = []BillingPack{
		{
			Code:       "starter",
			Label:      "Starter Pack",
			Credits:    20,
			PriceCents: 2000,
		},
	}
	cfg.PaddleEnvironment = paddleEnvironmentSandbox
	cfg.PaddleAPIKey = "test_api_key"
	cfg.PaddleClientToken = "test_client_token"
	cfg.PaddleWebhookSecret = "test_webhook_secret"
	cfg.PaddlePackPriceIDs = map[string]string{
		"starter": "pri_test_starter",
	}
	return cfg
}

func TestValidate_Valid(t *testing.T) {
	cfg := validConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidate_BillingValid(t *testing.T) {
	cfg := validBillingConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}

	if !cfg.BillingEnabled() {
		t.Fatal("expected billing to be enabled")
	}
	if cfg.BillingPublicConfig().ClientToken != "test_client_token" {
		t.Fatalf("unexpected billing client token %q", cfg.BillingPublicConfig().ClientToken)
	}

	pack, ok := cfg.FindBillingPack("starter")
	if !ok {
		t.Fatal("expected starter pack to be found")
	}
	if pack.PriceDisplay != "$20.00" {
		t.Fatalf("unexpected starter pack price display %q", pack.PriceDisplay)
	}
}

func TestValidate_DefaultsLLMProxyTimeout(t *testing.T) {
	cfg := validConfig()
	cfg.LLMProxyTimeout = 0
	if err := cfg.Validate(); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.LLMProxyTimeout != 30*time.Second {
		t.Fatalf("expected default timeout 30s, got %v", cfg.LLMProxyTimeout)
	}
	if cfg.BootstrapCoins != defaultBootstrapCoins {
		t.Fatalf("expected bootstrap default %d, got %d", defaultBootstrapCoins, cfg.BootstrapCoins)
	}
	if cfg.GenerateCoins != defaultGenerateCoins {
		t.Fatalf("expected generate default %d, got %d", defaultGenerateCoins, cfg.GenerateCoins)
	}
	if cfg.DailyLoginCoins != defaultDailyLoginCoins {
		t.Fatalf("expected daily login default %d, got %d", defaultDailyLoginCoins, cfg.DailyLoginCoins)
	}
	if cfg.OwnerSolveCoins != defaultOwnerSolveCoins {
		t.Fatalf("expected owner solve default %d, got %d", defaultOwnerSolveCoins, cfg.OwnerSolveCoins)
	}
	if cfg.CreatorSharedPerPuzzleCap != defaultCreatorSharedPerPuzzleCap {
		t.Fatalf("expected creator per-puzzle cap default %d, got %d", defaultCreatorSharedPerPuzzleCap, cfg.CreatorSharedPerPuzzleCap)
	}
}

func TestValidate_MissingFields(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Config)
	}{
		{"empty listen addr", func(c *Config) { c.ListenAddr = "" }},
		{"whitespace listen addr", func(c *Config) { c.ListenAddr = "   " }},
		{"empty ledger addr", func(c *Config) { c.LedgerAddress = "" }},
		{"zero ledger timeout", func(c *Config) { c.LedgerTimeout = 0 }},
		{"negative ledger timeout", func(c *Config) { c.LedgerTimeout = -1 }},
		{"empty tenant id", func(c *Config) { c.DefaultTenantID = "" }},
		{"empty ledger id", func(c *Config) { c.DefaultLedgerID = "" }},
		{"no allowed origins", func(c *Config) { c.AllowedOrigins = nil }},
		{"empty allowed origins", func(c *Config) { c.AllowedOrigins = []string{} }},
		{"empty signing key", func(c *Config) { c.SessionSigningKey = "" }},
		{"empty issuer", func(c *Config) { c.SessionIssuer = "" }},
		{"empty cookie name", func(c *Config) { c.SessionCookieName = "" }},
		{"empty tauth url", func(c *Config) { c.TAuthBaseURL = "" }},
		{"empty llm proxy url", func(c *Config) { c.LLMProxyURL = "" }},
		{"empty ledger secret key", func(c *Config) { c.LedgerSecretKey = "" }},
		{"whitespace ledger secret key", func(c *Config) { c.LedgerSecretKey = "   " }},
		{"empty llm proxy key", func(c *Config) { c.LLMProxyKey = "" }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestValidate_BillingValidationErrors(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Config)
	}{
		{
			name: "missing billing packs",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = nil
			},
		},
		{
			name: "invalid paddle environment",
			mutate: func(cfg *Config) {
				cfg.PaddleEnvironment = "staging"
			},
		},
		{
			name: "missing client token",
			mutate: func(cfg *Config) {
				cfg.PaddleClientToken = ""
			},
		},
		{
			name: "missing pack price id",
			mutate: func(cfg *Config) {
				cfg.PaddlePackPriceIDs = map[string]string{}
			},
		},
		{
			name: "duplicate pack codes",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = []BillingPack{
					{Code: "starter", Label: "Starter Pack", Credits: 20, PriceCents: 2000},
					{Code: "STARTER", Label: "Starter Copy", Credits: 30, PriceCents: 3000},
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validBillingConfig()
			tt.mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected billing validation error")
			}
		})
	}
}

func TestParseAllowedOrigins(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"", []string{}},
		{"   ", []string{}},
		{"http://a.com", []string{"http://a.com"}},
		{"http://a.com,http://b.com", []string{"http://a.com", "http://b.com"}},
		{" http://a.com , http://b.com , ", []string{"http://a.com", "http://b.com"}},
		{"http://a.com,,http://b.com", []string{"http://a.com", "http://b.com"}},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := ParseAllowedOrigins(tt.input)
			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d origins, got %d: %v", len(tt.expected), len(result), result)
			}
			for i, v := range result {
				if v != tt.expected[i] {
					t.Errorf("origin[%d] = %q, want %q", i, v, tt.expected[i])
				}
			}
		})
	}
}

func TestBootstrapAmountCents(t *testing.T) {
	want := int64(3000) // 30 coins * 100 cents
	if got := BootstrapAmountCents(); got != want {
		t.Fatalf("BootstrapAmountCents() = %d, want %d", got, want)
	}
}

func TestGenerateAmountCents(t *testing.T) {
	want := int64(400) // 4 coins * 100 cents
	if got := GenerateAmountCents(); got != want {
		t.Fatalf("GenerateAmountCents() = %d, want %d", got, want)
	}
}

func TestCoinValueCents(t *testing.T) {
	want := int64(100)
	if got := CoinValueCents(); got != want {
		t.Fatalf("CoinValueCents() = %d, want %d", got, want)
	}
}

func TestConfiguredAmountCentsMethods(t *testing.T) {
	cfg := validConfig()
	cfg.CoinValueCents = 100
	cfg.BootstrapCoins = 30
	cfg.GenerateCoins = 4
	cfg.DailyLoginCoins = 8
	cfg.OwnerSolveCoins = 3
	cfg.OwnerNoHintBonusCoins = 1
	cfg.OwnerDailySolveBonusCoins = 1
	cfg.CreatorSharedSolveCoins = 1

	if got := cfg.BootstrapAmountCents(); got != 3000 {
		t.Fatalf("BootstrapAmountCents() = %d, want %d", got, 3000)
	}
	if got := cfg.GenerateAmountCents(); got != 400 {
		t.Fatalf("GenerateAmountCents() = %d, want %d", got, 400)
	}
	if got := cfg.DailyLoginAmountCents(); got != 800 {
		t.Fatalf("DailyLoginAmountCents() = %d, want %d", got, 800)
	}
	if got := cfg.OwnerSolveAmountCents(); got != 300 {
		t.Fatalf("OwnerSolveAmountCents() = %d, want %d", got, 300)
	}
	if got := cfg.OwnerNoHintBonusAmountCents(); got != 100 {
		t.Fatalf("OwnerNoHintBonusAmountCents() = %d, want %d", got, 100)
	}
	if got := cfg.OwnerDailySolveBonusAmountCents(); got != 100 {
		t.Fatalf("OwnerDailySolveBonusAmountCents() = %d, want %d", got, 100)
	}
	if got := cfg.CreatorSharedSolveAmountCents(); got != 100 {
		t.Fatalf("CreatorSharedSolveAmountCents() = %d, want %d", got, 100)
	}
}

func TestParseAdminEmails(t *testing.T) {
	tests := []struct {
		input    string
		expected []string
	}{
		{"", []string{}},
		{"   ", []string{}},
		{"admin@example.com", []string{"admin@example.com"}},
		{"Admin@Example.COM", []string{"admin@example.com"}},
		{"a@b.com,c@d.com", []string{"a@b.com", "c@d.com"}},
		{" a@b.com , C@D.com , ", []string{"a@b.com", "c@d.com"}},
		{"a@b.com,,c@d.com", []string{"a@b.com", "c@d.com"}},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := ParseAdminEmails(tt.input)
			if len(result) != len(tt.expected) {
				t.Fatalf("expected %d emails, got %d: %v", len(tt.expected), len(result), result)
			}
			for i, v := range result {
				if v != tt.expected[i] {
					t.Errorf("email[%d] = %q, want %q", i, v, tt.expected[i])
				}
			}
		})
	}
}

func TestParseAdminEmailsFromYAML(t *testing.T) {
	yamlText := `
administrators:
  - "Admin@example.com"
  - 'boss@example.com'

environments:
  - description: "Local"
`

	got := ParseAdminEmailsFromYAML(yamlText)
	want := []string{"admin@example.com", "boss@example.com"}

	if len(got) != len(want) {
		t.Fatalf("expected %d emails, got %d: %v", len(want), len(got), got)
	}
	for index, email := range want {
		if got[index] != email {
			t.Fatalf("email[%d] = %q, want %q", index, got[index], email)
		}
	}
}

func TestLoadAdminEmailsFromYAMLFile(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yaml")
	configText := "administrators:\n  - \"admin@example.com\"\n"

	if err := os.WriteFile(configPath, []byte(configText), 0o644); err != nil {
		t.Fatalf("write config file: %v", err)
	}

	got, err := LoadAdminEmailsFromYAMLFile(configPath)
	if err != nil {
		t.Fatalf("LoadAdminEmailsFromYAMLFile() error = %v", err)
	}
	if len(got) != 1 || got[0] != "admin@example.com" {
		t.Fatalf("unexpected emails: %v", got)
	}
}

func TestMergeAdminEmails(t *testing.T) {
	got := MergeAdminEmails(
		[]string{"admin@example.com", "boss@example.com"},
		[]string{"Admin@example.com", "staff@example.com"},
	)
	want := []string{"admin@example.com", "boss@example.com", "staff@example.com"}

	if len(got) != len(want) {
		t.Fatalf("expected %d emails, got %d: %v", len(want), len(got), got)
	}
	for index, email := range want {
		if got[index] != email {
			t.Fatalf("email[%d] = %q, want %q", index, got[index], email)
		}
	}
}

func TestIsAdmin(t *testing.T) {
	cfg := Config{AdminEmails: []string{"admin@example.com", "boss@corp.io"}}

	tests := []struct {
		email string
		want  bool
	}{
		{"admin@example.com", true},
		{"Admin@Example.COM", true},
		{"boss@corp.io", true},
		{"user@example.com", false},
		{"", false},
		{"  ", false},
	}
	for _, tt := range tests {
		t.Run(tt.email, func(t *testing.T) {
			if got := cfg.IsAdmin(tt.email); got != tt.want {
				t.Errorf("IsAdmin(%q) = %v, want %v", tt.email, got, tt.want)
			}
		})
	}
}

func TestIsAdmin_EmptyList(t *testing.T) {
	cfg := Config{}
	if cfg.IsAdmin("anyone@example.com") {
		t.Error("expected false when admin list is empty")
	}
}
