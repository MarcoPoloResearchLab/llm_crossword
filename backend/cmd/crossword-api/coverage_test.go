package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MarcoPoloResearchLab/llm-crossword/backend/internal/crosswordapi"
)

func setRequiredConfigEnv(t *testing.T) {
	t.Helper()

	t.Setenv("CROSSWORDAPI_LISTEN_ADDR", ":9090")
	t.Setenv("CROSSWORDAPI_LEDGER_ADDR", "localhost:50051")
	t.Setenv("CROSSWORDAPI_LEDGER_INSECURE", "true")
	t.Setenv("CROSSWORDAPI_LEDGER_TIMEOUT", "5s")
	t.Setenv("CROSSWORDAPI_LEDGER_SECRET_KEY", "test-secret")
	t.Setenv("CROSSWORDAPI_DEFAULT_TENANT_ID", "tenant-1")
	t.Setenv("CROSSWORDAPI_DEFAULT_LEDGER_ID", "ledger-1")
	t.Setenv("CROSSWORDAPI_ALLOWED_ORIGINS", "http://localhost:8000")
	t.Setenv("CROSSWORDAPI_JWT_SIGNING_KEY", "test-secret-key")
	t.Setenv("CROSSWORDAPI_JWT_ISSUER", "tauth")
	t.Setenv("CROSSWORDAPI_JWT_COOKIE_NAME", "app_session")
	t.Setenv("CROSSWORDAPI_TAUTH_BASE_URL", "http://localhost:8080")
	t.Setenv("CROSSWORDAPI_LLM_PROXY_URL", "http://localhost:9999")
	t.Setenv("CROSSWORDAPI_LLM_PROXY_KEY", "secret")
	t.Setenv("CROSSWORDAPI_LLM_PROXY_TIMEOUT", "30s")
}

func TestMain_UsesExitFunc(t *testing.T) {
	originalArgs := os.Args
	originalExitFunc := exitFunc
	exitCode := -1

	os.Args = []string{"crossword-api", "--help"}
	exitFunc = func(code int) {
		exitCode = code
	}
	defer func() {
		os.Args = originalArgs
		exitFunc = originalExitFunc
	}()

	main()

	if exitCode != 0 {
		t.Fatalf("expected exit code 0, got %d", exitCode)
	}
}

func TestLoadConfig_AdminConfigReadError(t *testing.T) {
	setRequiredConfigEnv(t)

	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "configs")
	configPath := filepath.Join(configDir, "config.yml")

	if err := os.MkdirAll(configPath, 0o755); err != nil {
		t.Fatalf("mkdir config path: %v", err)
	}

	originalWorkingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir(tempDir); err != nil {
		t.Fatalf("chdir tempDir: %v", err)
	}
	defer os.Chdir(originalWorkingDirectory)

	cfg := &crosswordapi.Config{}
	err = loadConfig(newRootCommand(), cfg)
	if err == nil {
		t.Fatal("expected config read error")
	}
	if !strings.Contains(err.Error(), "load app config configs/config.yml") {
		t.Fatalf("expected wrapped config path error, got %v", err)
	}
}

func TestLoadAdminEmailsFromConfigPaths_SkipsBlankAndMissing(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config.yml")

	if err := os.WriteFile(configPath, []byte("administrators:\n  - admin@example.com\n"), 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	emails, err := loadAdminEmailsFromConfigPaths([]string{
		"   ",
		filepath.Join(tempDir, "missing.yaml"),
		configPath,
	})
	if err != nil {
		t.Fatalf("loadAdminEmailsFromConfigPaths() error = %v", err)
	}
	if len(emails) != 1 || emails[0] != "admin@example.com" {
		t.Fatalf("unexpected emails: %v", emails)
	}
}

func TestLoadAdminEmailsFromConfigPaths_UnexpectedError(t *testing.T) {
	_, err := loadAdminEmailsFromConfigPaths([]string{t.TempDir()})
	if err == nil {
		t.Fatal("expected unexpected filesystem error")
	}
}
