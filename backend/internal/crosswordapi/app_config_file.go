package crosswordapi

import (
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

type AppConfigFile struct {
	Administrators []string         `yaml:"administrators"`
	Billing        appBillingConfig `yaml:"billing"`
	Economy        appEconomyConfig `yaml:"economy"`
}

type appBillingConfig struct {
	Packs []BillingPack `yaml:"packs"`
}

type appEconomyConfig struct {
	CoinValueCents int64                      `yaml:"coin_value_cents"`
	Grants         appEconomyGrantsConfig     `yaml:"grants"`
	Generation     appEconomyGenerationConfig `yaml:"generation"`
	Rewards        appEconomyRewardsConfig    `yaml:"rewards"`
}

type appEconomyGrantsConfig struct {
	BootstrapCredits       int64 `yaml:"bootstrap_credits"`
	DailyLoginCredits      int64 `yaml:"daily_login_credits"`
	LowBalanceFloorCredits int64 `yaml:"low_balance_floor_credits"`
}

type appEconomyGenerationConfig struct {
	CostCredits int64 `yaml:"cost_credits"`
}

type appEconomyRewardsConfig struct {
	OwnerSolveCredits                int64 `yaml:"owner_solve_credits"`
	OwnerNoHintBonusCredits          int64 `yaml:"owner_no_hint_bonus_credits"`
	OwnerDailySolveBonusCredits      int64 `yaml:"owner_daily_solve_bonus_credits"`
	OwnerDailySolveBonusLimit        int64 `yaml:"owner_daily_solve_bonus_limit"`
	CreatorSharedSolveCredits        int64 `yaml:"creator_shared_solve_credits"`
	CreatorSharedPerPuzzleCapCredits int64 `yaml:"creator_shared_per_puzzle_cap_credits"`
	CreatorSharedDailyCapCredits     int64 `yaml:"creator_shared_daily_cap_credits"`
}

func (configFile *AppConfigFile) ApplyToRuntimeConfig(cfg *Config) {
	if configFile == nil || cfg == nil {
		return
	}

	cfg.BillingPacks = configFile.Billing.Packs

	if configFile.Economy.CoinValueCents > 0 {
		cfg.CoinValueCents = configFile.Economy.CoinValueCents
	}
	if configFile.Economy.Grants.BootstrapCredits > 0 {
		cfg.BootstrapCoins = configFile.Economy.Grants.BootstrapCredits
	}
	if configFile.Economy.Generation.CostCredits > 0 {
		cfg.GenerateCoins = configFile.Economy.Generation.CostCredits
	}
	if configFile.Economy.Grants.DailyLoginCredits > 0 {
		cfg.DailyLoginCoins = configFile.Economy.Grants.DailyLoginCredits
	}
	if configFile.Economy.Grants.LowBalanceFloorCredits > 0 {
		cfg.LowBalanceFloorCoins = configFile.Economy.Grants.LowBalanceFloorCredits
	}
	if configFile.Economy.Rewards.OwnerSolveCredits > 0 {
		cfg.OwnerSolveCoins = configFile.Economy.Rewards.OwnerSolveCredits
	}
	if configFile.Economy.Rewards.OwnerNoHintBonusCredits > 0 {
		cfg.OwnerNoHintBonusCoins = configFile.Economy.Rewards.OwnerNoHintBonusCredits
	}
	if configFile.Economy.Rewards.OwnerDailySolveBonusCredits > 0 {
		cfg.OwnerDailySolveBonusCoins = configFile.Economy.Rewards.OwnerDailySolveBonusCredits
	}
	if configFile.Economy.Rewards.OwnerDailySolveBonusLimit > 0 {
		cfg.OwnerDailySolveBonusLimit = configFile.Economy.Rewards.OwnerDailySolveBonusLimit
	}
	if configFile.Economy.Rewards.CreatorSharedSolveCredits > 0 {
		cfg.CreatorSharedSolveCoins = configFile.Economy.Rewards.CreatorSharedSolveCredits
	}
	if configFile.Economy.Rewards.CreatorSharedPerPuzzleCapCredits > 0 {
		cfg.CreatorSharedPerPuzzleCap = configFile.Economy.Rewards.CreatorSharedPerPuzzleCapCredits
	}
	if configFile.Economy.Rewards.CreatorSharedDailyCapCredits > 0 {
		cfg.CreatorSharedDailyCap = configFile.Economy.Rewards.CreatorSharedDailyCapCredits
	}
}

var configEnvVariablePattern = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)`)

func expandConfigEnvVariables(configText string) (string, error) {
	if configText == "" {
		return "", nil
	}

	missingVariables := make([]string, 0)
	seenMissingVariables := make(map[string]struct{})
	expandedConfigText := configEnvVariablePattern.ReplaceAllStringFunc(configText, func(rawMatch string) string {
		variableName := strings.TrimPrefix(rawMatch, "$")
		if strings.HasPrefix(variableName, "{") && strings.HasSuffix(variableName, "}") {
			variableName = strings.TrimSuffix(strings.TrimPrefix(variableName, "{"), "}")
		}

		value, exists := os.LookupEnv(variableName)
		if exists {
			return value
		}

		if _, alreadyRecorded := seenMissingVariables[variableName]; !alreadyRecorded {
			seenMissingVariables[variableName] = struct{}{}
			missingVariables = append(missingVariables, variableName)
		}
		return rawMatch
	})
	if len(missingVariables) > 0 {
		return "", fmt.Errorf("missing env variables: %s", strings.Join(missingVariables, ", "))
	}

	return expandedConfigText, nil
}

func loadAppConfigFile(path string) (*AppConfigFile, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("config path is required")
	}

	configBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	expandedConfigText, err := expandConfigEnvVariables(string(configBytes))
	if err != nil {
		return nil, fmt.Errorf("expand env variables: %w", err)
	}

	configFile := &AppConfigFile{}
	if err := yaml.Unmarshal([]byte(expandedConfigText), configFile); err != nil {
		return nil, err
	}
	return configFile, nil
}

func LoadAppConfigFile(path string) (*AppConfigFile, error) {
	return loadAppConfigFile(path)
}

func loadAppConfigFromPaths(paths []string) (*AppConfigFile, error) {
	for _, path := range paths {
		trimmedPath := strings.TrimSpace(path)
		if trimmedPath == "" {
			continue
		}

		configFile, err := loadAppConfigFile(trimmedPath)
		if err == nil {
			return configFile, nil
		}
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		return nil, fmt.Errorf("load app config %s: %w", trimmedPath, err)
	}

	return &AppConfigFile{}, nil
}

func LoadAppConfig(paths []string) (*AppConfigFile, error) {
	return loadAppConfigFromPaths(paths)
}
