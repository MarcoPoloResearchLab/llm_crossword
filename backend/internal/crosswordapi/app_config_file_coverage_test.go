package crosswordapi

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadAppConfigFileAndPathsCoverage(t *testing.T) {
	t.Run("empty config text expands to empty", func(t *testing.T) {
		expandedConfigText, err := expandConfigEnvVariables("")
		if err != nil {
			t.Fatalf("expandConfigEnvVariables() error = %v", err)
		}
		if expandedConfigText != "" {
			t.Fatalf("expected empty expanded config text, got %q", expandedConfigText)
		}
	})

	t.Run("blank path fails", func(t *testing.T) {
		_, err := loadAppConfigFile("   ")
		if err == nil || !strings.Contains(err.Error(), "config path is required") {
			t.Fatalf("expected config path error, got %v", err)
		}
	})

	t.Run("invalid yaml fails", func(t *testing.T) {
		configPath := filepath.Join(t.TempDir(), "config.yaml")
		if err := os.WriteFile(configPath, []byte("billing: ["), 0o644); err != nil {
			t.Fatalf("write invalid yaml: %v", err)
		}

		_, err := LoadAppConfigFile(configPath)
		if err == nil {
			t.Fatal("expected yaml unmarshal error")
		}
	})

	t.Run("load file and exported wrapper succeed", func(t *testing.T) {
		configPath := filepath.Join(t.TempDir(), "config.yaml")
		configYAML := strings.Join([]string{
			"administrators:",
			"  - admin@example.com",
			"economy:",
			"  coin_value_cents: 10",
			"  grants:",
			"    bootstrap_credits: 300",
			"    daily_login_credits: 80",
			"    low_balance_floor_credits: 40",
			"  generation:",
			"    cost_credits: 40",
			"  rewards:",
			"    owner_solve_credits: 30",
			"    owner_no_hint_bonus_credits: 10",
			"    owner_daily_solve_bonus_credits: 10",
			"    owner_daily_solve_bonus_limit: 3",
			"    creator_shared_solve_credits: 10",
			"    creator_shared_per_puzzle_cap_credits: 100",
			"    creator_shared_daily_cap_credits: 200",
			"billing:",
			"  packs:",
			"    - code: starter",
			"      label: Starter Pack",
			"      credits: 20",
			"      price_cents: 2000",
			"",
		}, "\n")
		if err := os.WriteFile(configPath, []byte(configYAML), 0o644); err != nil {
			t.Fatalf("write config yaml: %v", err)
		}

		configFile, err := loadAppConfigFile(configPath)
		if err != nil {
			t.Fatalf("loadAppConfigFile() error = %v", err)
		}
		if len(configFile.Administrators) != 1 || configFile.Administrators[0] != "admin@example.com" {
			t.Fatalf("unexpected administrators: %#v", configFile.Administrators)
		}
		if len(configFile.Billing.Packs) != 1 || configFile.Billing.Packs[0].Code != "starter" {
			t.Fatalf("unexpected billing packs: %#v", configFile.Billing.Packs)
		}
		if configFile.Economy.Generation.CostCredits != 40 {
			t.Fatalf("unexpected generation cost credits: %#v", configFile.Economy.Generation)
		}

		wrappedConfig, err := LoadAppConfig([]string{"", filepath.Join(filepath.Dir(configPath), "missing.yaml"), configPath})
		if err != nil {
			t.Fatalf("LoadAppConfig() error = %v", err)
		}
		if len(wrappedConfig.Billing.Packs) != 1 || wrappedConfig.Billing.Packs[0].Label != "Starter Pack" {
			t.Fatalf("unexpected wrapped config: %#v", wrappedConfig)
		}

		runtimeConfig := validConfig()
		wrappedConfig.ApplyToRuntimeConfig(&runtimeConfig)
		if runtimeConfig.CoinValueCents != 10 || runtimeConfig.GenerateCoins != 40 {
			t.Fatalf("unexpected runtime economy config: %#v", runtimeConfig)
		}
		if runtimeConfig.CreatorSharedPerPuzzleCap != 100 || runtimeConfig.CreatorSharedDailyCap != 200 {
			t.Fatalf("unexpected runtime reward config: %#v", runtimeConfig)
		}
	})

	t.Run("environment variables are expanded before yaml parsing", func(t *testing.T) {
		t.Setenv("PACK_LABEL", "Expanded Starter Pack")

		configPath := filepath.Join(t.TempDir(), "config.yaml")
		configYAML := strings.Join([]string{
			"billing:",
			"  packs:",
			"    - code: starter",
			"      label: ${PACK_LABEL}",
			"      credits: 20",
			"      price_cents: 2000",
			"",
		}, "\n")
		if err := os.WriteFile(configPath, []byte(configYAML), 0o644); err != nil {
			t.Fatalf("write config yaml: %v", err)
		}

		configFile, err := loadAppConfigFile(configPath)
		if err != nil {
			t.Fatalf("loadAppConfigFile() error = %v", err)
		}
		if len(configFile.Billing.Packs) != 1 || configFile.Billing.Packs[0].Label != "Expanded Starter Pack" {
			t.Fatalf("expected expanded label, got %#v", configFile.Billing.Packs)
		}
	})

	t.Run("missing environment variables fail the load", func(t *testing.T) {
		configPath := filepath.Join(t.TempDir(), "config.yaml")
		configYAML := strings.Join([]string{
			"billing:",
			"  packs:",
			"    - code: starter",
			"      label: ${MISSING_PACK_LABEL}",
			"      credits: 20",
			"      price_cents: 2000",
			"",
		}, "\n")
		if err := os.WriteFile(configPath, []byte(configYAML), 0o644); err != nil {
			t.Fatalf("write config yaml: %v", err)
		}

		_, err := loadAppConfigFile(configPath)
		if err == nil || !strings.Contains(err.Error(), "missing env variables: MISSING_PACK_LABEL") {
			t.Fatalf("expected missing env error, got %v", err)
		}
	})

	t.Run("all missing files returns empty config", func(t *testing.T) {
		configFile, err := loadAppConfigFromPaths([]string{"", filepath.Join(t.TempDir(), "missing.yaml")})
		if err != nil {
			t.Fatalf("loadAppConfigFromPaths() error = %v", err)
		}
		if configFile == nil {
			t.Fatal("expected non-nil empty config file")
		}
		if len(configFile.Administrators) != 0 || len(configFile.Billing.Packs) != 0 {
			t.Fatalf("expected empty config, got %#v", configFile)
		}
	})

	t.Run("non-not-exist error is wrapped", func(t *testing.T) {
		configPath := filepath.Join(t.TempDir(), "config.yaml")
		if err := os.WriteFile(configPath, []byte("billing:\n  packs:\n    - code: ["), 0o644); err != nil {
			t.Fatalf("write malformed config: %v", err)
		}

		_, err := loadAppConfigFromPaths([]string{configPath})
		if err == nil || !strings.Contains(err.Error(), "load app config") {
			t.Fatalf("expected wrapped load error, got %v", err)
		}
	})
}
