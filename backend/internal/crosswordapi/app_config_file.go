package crosswordapi

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type AppConfigFile struct {
	Administrators []string         `yaml:"administrators"`
	Billing        appBillingConfig `yaml:"billing"`
}

type appBillingConfig struct {
	Packs []BillingPack `yaml:"packs"`
}

func loadAppConfigFile(path string) (*AppConfigFile, error) {
	if strings.TrimSpace(path) == "" {
		return nil, fmt.Errorf("config path is required")
	}

	configBytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	configFile := &AppConfigFile{}
	if err := yaml.Unmarshal(configBytes, configFile); err != nil {
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
