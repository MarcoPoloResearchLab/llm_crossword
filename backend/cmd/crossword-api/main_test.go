package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MarcoPoloResearchLab/llm-crossword/backend/internal/crosswordapi"
	"github.com/spf13/cobra"
)

func TestNewRootCommand(t *testing.T) {
	cmd := newRootCommand()
	if cmd.Use != "crossword-api" {
		t.Fatalf("expected use 'crossword-api', got %q", cmd.Use)
	}
	if cmd.Short == "" {
		t.Fatal("expected non-empty short description")
	}
	// Verify all flags are registered.
	flags := []string{
		flagListenAddr, flagLedgerAddr, flagLedgerInsecure, flagLedgerTimeout,
		flagDefaultTenant, flagDefaultLedger, flagAllowedOrigins,
		flagJWTSigningKey, flagJWTIssuer, flagJWTCookieName, flagTAuthBaseURL,
		flagLLMProxyURL, flagLLMProxyKey, flagLLMProxyTimeout,
	}
	for _, f := range flags {
		if cmd.Flags().Lookup(f) == nil {
			t.Errorf("missing flag: %s", f)
		}
	}
}

func TestLoadConfig_MissingRequired(t *testing.T) {
	cmd := newRootCommand()
	cfg := &crosswordapi.Config{}
	// No env vars or flags set — should fail on first required field.
	err := loadConfig(cmd, cfg)
	if err == nil {
		t.Fatal("expected error for missing required fields")
	}
}

func TestLoadConfig_AllSet(t *testing.T) {
	envVars := map[string]string{
		"CROSSWORDAPI_LISTEN_ADDR":       ":9090",
		"CROSSWORDAPI_LEDGER_ADDR":       "localhost:50051",
		"CROSSWORDAPI_LEDGER_INSECURE":   "true",
		"CROSSWORDAPI_LEDGER_TIMEOUT":    "5s",
		"CROSSWORDAPI_DEFAULT_TENANT_ID": "t1",
		"CROSSWORDAPI_DEFAULT_LEDGER_ID": "l1",
		"CROSSWORDAPI_ALLOWED_ORIGINS":   "http://localhost:8000",
		"CROSSWORDAPI_JWT_SIGNING_KEY":   "test-key",
		"CROSSWORDAPI_JWT_ISSUER":        "tauth",
		"CROSSWORDAPI_JWT_COOKIE_NAME":   "app_session",
		"CROSSWORDAPI_TAUTH_BASE_URL":    "http://localhost:8080",
		"CROSSWORDAPI_LLM_PROXY_URL":     "http://localhost:9999",
		"CROSSWORDAPI_LLM_PROXY_KEY":     "secret",
		"CROSSWORDAPI_LLM_PROXY_TIMEOUT": "30s",
	}
	for k, v := range envVars {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range envVars {
			os.Unsetenv(k)
		}
	}()

	cmd := newRootCommand()
	cfg := &crosswordapi.Config{}
	if err := loadConfig(cmd, cfg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if cfg.ListenAddr != ":9090" {
		t.Errorf("expected :9090, got %q", cfg.ListenAddr)
	}
	if !cfg.LedgerInsecure {
		t.Error("expected LedgerInsecure true")
	}
	if len(cfg.AllowedOrigins) != 1 || cfg.AllowedOrigins[0] != "http://localhost:8000" {
		t.Errorf("unexpected origins: %v", cfg.AllowedOrigins)
	}
}

func TestLoadConfig_AdminEmailsFromConfigYAML(t *testing.T) {
	envVars := map[string]string{
		"CROSSWORDAPI_LISTEN_ADDR":       ":9090",
		"CROSSWORDAPI_LEDGER_ADDR":       "localhost:50051",
		"CROSSWORDAPI_LEDGER_INSECURE":   "true",
		"CROSSWORDAPI_LEDGER_TIMEOUT":    "5s",
		"CROSSWORDAPI_DEFAULT_TENANT_ID": "t1",
		"CROSSWORDAPI_DEFAULT_LEDGER_ID": "l1",
		"CROSSWORDAPI_ALLOWED_ORIGINS":   "http://localhost:8000",
		"CROSSWORDAPI_JWT_SIGNING_KEY":   "test-key",
		"CROSSWORDAPI_JWT_ISSUER":        "tauth",
		"CROSSWORDAPI_JWT_COOKIE_NAME":   "app_session",
		"CROSSWORDAPI_TAUTH_BASE_URL":    "http://localhost:8080",
		"CROSSWORDAPI_LLM_PROXY_URL":     "http://localhost:9999",
		"CROSSWORDAPI_LLM_PROXY_KEY":     "secret",
		"CROSSWORDAPI_LLM_PROXY_TIMEOUT": "30s",
	}
	for key, value := range envVars {
		os.Setenv(key, value)
	}
	defer func() {
		for key := range envVars {
			os.Unsetenv(key)
		}
	}()

	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("administrators:\n  - \"admin@example.com\"\n"), 0o644); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}

	originalWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir tempDir: %v", err)
	}
	defer os.Chdir(originalWorkingDirectory)

	cmd := newRootCommand()
	cfg := &crosswordapi.Config{}
	if err := loadConfig(cmd, cfg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(cfg.AdminEmails) != 1 || cfg.AdminEmails[0] != "admin@example.com" {
		t.Fatalf("unexpected admin emails: %v", cfg.AdminEmails)
	}
}

func TestLoadConfig_AdminEmailsMergeEnvAndConfig(t *testing.T) {
	envVars := map[string]string{
		"CROSSWORDAPI_LISTEN_ADDR":       ":9090",
		"CROSSWORDAPI_LEDGER_ADDR":       "localhost:50051",
		"CROSSWORDAPI_LEDGER_INSECURE":   "true",
		"CROSSWORDAPI_LEDGER_TIMEOUT":    "5s",
		"CROSSWORDAPI_DEFAULT_TENANT_ID": "t1",
		"CROSSWORDAPI_DEFAULT_LEDGER_ID": "l1",
		"CROSSWORDAPI_ALLOWED_ORIGINS":   "http://localhost:8000",
		"CROSSWORDAPI_JWT_SIGNING_KEY":   "test-key",
		"CROSSWORDAPI_JWT_ISSUER":        "tauth",
		"CROSSWORDAPI_JWT_COOKIE_NAME":   "app_session",
		"CROSSWORDAPI_TAUTH_BASE_URL":    "http://localhost:8080",
		"CROSSWORDAPI_LLM_PROXY_URL":     "http://localhost:9999",
		"CROSSWORDAPI_LLM_PROXY_KEY":     "secret",
		"CROSSWORDAPI_LLM_PROXY_TIMEOUT": "30s",
		"CROSSWORDAPI_ADMIN_EMAILS":      "env-admin@example.com",
	}
	for key, value := range envVars {
		os.Setenv(key, value)
	}
	defer func() {
		for key := range envVars {
			os.Unsetenv(key)
		}
	}()

	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("administrators:\n  - \"file-admin@example.com\"\n"), 0o644); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}

	originalWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir tempDir: %v", err)
	}
	defer os.Chdir(originalWorkingDirectory)

	cmd := newRootCommand()
	cfg := &crosswordapi.Config{}
	if err := loadConfig(cmd, cfg); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if len(cfg.AdminEmails) != 2 {
		t.Fatalf("expected merged admin emails, got %v", cfg.AdminEmails)
	}
	if cfg.AdminEmails[0] != "env-admin@example.com" || cfg.AdminEmails[1] != "file-admin@example.com" {
		t.Fatalf("unexpected merged admin emails: %v", cfg.AdminEmails)
	}
}

func TestNewRootCommand_ExecuteNoArgs(t *testing.T) {
	// Execute without any env/flags — PreRunE should fail with missing required field.
	cmd := newRootCommand()
	err := cmd.Execute()
	if err == nil {
		t.Fatal("expected error when no config is provided")
	}
}

func TestRun_MissingFlags(t *testing.T) {
	// run() with no env vars or flags should fail because required config is missing.
	code := run()
	if code == 0 {
		t.Fatal("expected non-zero exit code when required flags are missing")
	}
}

func TestRun_SuccessPath(t *testing.T) {
	// Override os.Args to pass --help so Execute() returns nil without running RunE.
	origArgs := os.Args
	os.Args = []string{"crossword-api", "--help"}
	defer func() { os.Args = origArgs }()

	code := run()
	if code != 0 {
		t.Fatalf("expected exit code 0 for --help, got %d", code)
	}
}

func TestRun_RunE_WithEnvVars(t *testing.T) {
	// Set ALL required env vars so PreRunE (loadConfig) succeeds,
	// but use an unreachable ledger address so RunE fails with a connection error.
	envVars := map[string]string{
		"CROSSWORDAPI_LISTEN_ADDR":       ":0",
		"CROSSWORDAPI_LEDGER_ADDR":       "127.0.0.1:1", // unreachable
		"CROSSWORDAPI_LEDGER_INSECURE":   "true",
		"CROSSWORDAPI_LEDGER_TIMEOUT":    "1s",
		"CROSSWORDAPI_DEFAULT_TENANT_ID": "t1",
		"CROSSWORDAPI_DEFAULT_LEDGER_ID": "l1",
		"CROSSWORDAPI_ALLOWED_ORIGINS":   "http://localhost",
		"CROSSWORDAPI_JWT_SIGNING_KEY":   "test-secret-key-long-enough-for-hmac",
		"CROSSWORDAPI_JWT_ISSUER":        "tauth",
		"CROSSWORDAPI_JWT_COOKIE_NAME":   "app_session",
		"CROSSWORDAPI_TAUTH_BASE_URL":    "http://localhost:8080",
		"CROSSWORDAPI_LLM_PROXY_URL":     "http://localhost:9999",
		"CROSSWORDAPI_LLM_PROXY_KEY":     "secret",
		"CROSSWORDAPI_LLM_PROXY_TIMEOUT": "1s",
	}
	for k, v := range envVars {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range envVars {
			os.Unsetenv(k)
		}
	}()

	// Use newRootCommand directly with a context that has a timeout,
	// so the connection attempt to the unreachable address times out.
	cmd := newRootCommand()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	cmd.SetContext(ctx)

	err := cmd.Execute()
	// Should fail with a connection error (not a config error).
	if err == nil {
		t.Fatal("expected error for unreachable ledger")
	}
	if !strings.Contains(err.Error(), "connect ledger") {
		t.Fatalf("expected connection error, got: %v", err)
	}
}

func TestLoadConfig_BindPFlagError(t *testing.T) {
	// Use a bare cobra.Command with no flags registered.
	// cmd.Flags().Lookup will return nil, causing BindPFlag to panic or error.
	cmd := &cobra.Command{}
	cfg := &crosswordapi.Config{}
	err := loadConfig(cmd, cfg)
	if err == nil {
		t.Fatal("expected error when flags are not registered")
	}
}

func TestLoadAdminEmailsFromConfigPaths(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("administrators:\n  - \"admin@example.com\"\n"), 0o644); err != nil {
		t.Fatalf("write config.yaml: %v", err)
	}

	adminEmails, err := loadAdminEmailsFromConfigPaths([]string{
		filepath.Join(tempDir, "missing.yaml"),
		configPath,
	})
	if err != nil {
		t.Fatalf("loadAdminEmailsFromConfigPaths() error = %v", err)
	}
	if len(adminEmails) != 1 || adminEmails[0] != "admin@example.com" {
		t.Fatalf("unexpected admin emails: %v", adminEmails)
	}
}

func TestLoadConfig_ValidationError(t *testing.T) {
	envVars := map[string]string{
		"CROSSWORDAPI_LISTEN_ADDR":       "   ", // whitespace only — fails Validate
		"CROSSWORDAPI_LEDGER_ADDR":       "localhost:50051",
		"CROSSWORDAPI_LEDGER_INSECURE":   "true",
		"CROSSWORDAPI_LEDGER_TIMEOUT":    "5s",
		"CROSSWORDAPI_DEFAULT_TENANT_ID": "t1",
		"CROSSWORDAPI_DEFAULT_LEDGER_ID": "l1",
		"CROSSWORDAPI_ALLOWED_ORIGINS":   "http://localhost",
		"CROSSWORDAPI_JWT_SIGNING_KEY":   "key",
		"CROSSWORDAPI_JWT_ISSUER":        "tauth",
		"CROSSWORDAPI_JWT_COOKIE_NAME":   "sess",
		"CROSSWORDAPI_TAUTH_BASE_URL":    "http://localhost",
		"CROSSWORDAPI_LLM_PROXY_URL":     "http://localhost",
		"CROSSWORDAPI_LLM_PROXY_KEY":     "key",
	}
	for k, v := range envVars {
		os.Setenv(k, v)
	}
	defer func() {
		for k := range envVars {
			os.Unsetenv(k)
		}
	}()

	cmd := newRootCommand()
	cfg := &crosswordapi.Config{}
	err := loadConfig(cmd, cfg)
	if err == nil {
		t.Fatal("expected validation error for whitespace listen addr")
	}
}
