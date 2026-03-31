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
}

type appBillingConfig struct {
	Packs []BillingPack `yaml:"packs"`
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
