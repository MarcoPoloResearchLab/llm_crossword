package main

import (
	"errors"
	"fmt"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/MarcoPoloResearchLab/llm-crossword/backend/internal/crosswordapi"
	"github.com/spf13/cobra"
	"github.com/spf13/viper"
)

const (
	flagListenAddr      = "listen-addr"
	flagLedgerAddr      = "ledger-addr"
	flagLedgerInsecure  = "ledger-insecure"
	flagLedgerTimeout   = "ledger-timeout"
	flagLedgerSecretKey = "ledger-secret-key"
	flagDefaultTenant   = "default-tenant-id"
	flagDefaultLedger   = "default-ledger-id"
	flagAllowedOrigins  = "allowed-origins"
	flagJWTSigningKey   = "jwt-signing-key"
	flagJWTIssuer       = "jwt-issuer"
	flagJWTCookieName   = "jwt-cookie-name"
	flagTAuthBaseURL    = "tauth-base-url"
	flagLLMProxyURL     = "llm-proxy-url"
	flagLLMProxyKey     = "llm-proxy-key"
	flagLLMProxyTimeout = "llm-proxy-timeout"
	flagDatabaseDSN     = "database-dsn"
	flagAdminEmails     = "admin-emails"
	flagBillingProvider = "billing-provider"
	flagPaddleEnv       = "paddle-environment"
	flagPaddleAPIKey    = "paddle-api-key"
	flagPaddleAPIBase   = "paddle-api-base-url"
	flagPaddleClientTok = "paddle-client-token"
	flagPaddleWebhook   = "paddle-webhook-secret"
	envPrefix           = "CROSSWORDAPI"
)

var defaultAppConfigPaths = []string{
	"/configs/config.yml",
	"configs/config.yml",
}

var exitFunc = os.Exit

// run executes the root command and returns the exit code.
func run() int {
	rootCmd := newRootCommand()
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintf(os.Stderr, "crossword-api: %v\n", err)
		return 1
	}
	return 0
}

func main() {
	exitFunc(run())
}

func newRootCommand() *cobra.Command {
	cfg := crosswordapi.Config{}
	cmd := &cobra.Command{
		Use:           "crossword-api",
		Short:         "HTTP API for LLM crossword generation",
		SilenceUsage:  true,
		SilenceErrors: true,
		PreRunE: func(cmd *cobra.Command, args []string) error {
			return loadConfig(cmd, &cfg)
		},
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, stop := signal.NotifyContext(cmd.Context(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			return crosswordapi.Run(ctx, cfg)
		},
	}

	registerConfigFlags(cmd)

	return cmd
}

func registerConfigFlags(cmd *cobra.Command) {
	cmd.Flags().String(flagListenAddr, "", "HTTP listen address")
	cmd.Flags().String(flagLedgerAddr, "", "ledger gRPC address")
	cmd.Flags().Bool(flagLedgerInsecure, false, "use insecure ledger connection")
	cmd.Flags().Duration(flagLedgerTimeout, 0, "ledger RPC timeout")
	cmd.Flags().String(flagLedgerSecretKey, "", "ledger per-tenant secret key")
	cmd.Flags().String(flagDefaultTenant, "", "default tenant id")
	cmd.Flags().String(flagDefaultLedger, "", "default ledger id")
	cmd.Flags().String(flagAllowedOrigins, "", "comma-separated CORS origins")
	cmd.Flags().String(flagJWTSigningKey, "", "TAuth JWT signing key")
	cmd.Flags().String(flagJWTIssuer, "", "expected JWT issuer")
	cmd.Flags().String(flagJWTCookieName, "", "JWT cookie name")
	cmd.Flags().String(flagTAuthBaseURL, "", "TAuth base URL")
	cmd.Flags().String(flagLLMProxyURL, "", "LLM proxy URL")
	cmd.Flags().String(flagLLMProxyKey, "", "LLM proxy service secret")
	cmd.Flags().Duration(flagLLMProxyTimeout, 0, "LLM proxy request timeout")
	cmd.Flags().String(flagDatabaseDSN, "crosswords.db", "SQLite database path")
	cmd.Flags().String(flagAdminEmails, "", "comma-separated list of administrator emails")
	cmd.Flags().String(flagBillingProvider, "", "billing provider code")
	cmd.Flags().String(flagPaddleEnv, "", "Paddle environment (sandbox or production)")
	cmd.Flags().String(flagPaddleAPIKey, "", "Paddle API key")
	cmd.Flags().String(flagPaddleAPIBase, "", "Paddle API base URL override")
	cmd.Flags().String(flagPaddleClientTok, "", "Paddle client token")
	cmd.Flags().String(flagPaddleWebhook, "", "Paddle webhook secret")
}

func loadConfig(cmd *cobra.Command, cfg *crosswordapi.Config) error {
	v := viper.New()
	v.SetEnvPrefix(envPrefix)
	v.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
	v.AutomaticEnv()

	allFlags := []string{
		flagListenAddr, flagLedgerAddr, flagLedgerInsecure, flagLedgerTimeout, flagLedgerSecretKey,
		flagDefaultTenant, flagDefaultLedger, flagAllowedOrigins,
		flagJWTSigningKey, flagJWTIssuer, flagJWTCookieName, flagTAuthBaseURL,
		flagLLMProxyURL, flagLLMProxyKey, flagLLMProxyTimeout,
		flagDatabaseDSN,
		flagAdminEmails,
		flagBillingProvider, flagPaddleEnv, flagPaddleAPIKey, flagPaddleAPIBase, flagPaddleClientTok, flagPaddleWebhook,
	}
	for _, flagName := range allFlags {
		if err := v.BindPFlag(flagName, cmd.Flags().Lookup(flagName)); err != nil {
			return err
		}
	}

	required := []string{
		flagListenAddr, flagLedgerAddr, flagLedgerInsecure, flagLedgerTimeout, flagLedgerSecretKey,
		flagDefaultTenant, flagDefaultLedger, flagAllowedOrigins,
		flagJWTSigningKey, flagJWTIssuer, flagJWTCookieName, flagTAuthBaseURL,
		flagLLMProxyURL, flagLLMProxyKey,
	}
	for _, flag := range required {
		if !v.IsSet(flag) {
			return fmt.Errorf("%s is required", flag)
		}
	}

	cfg.ListenAddr = strings.TrimSpace(v.GetString(flagListenAddr))
	cfg.LedgerAddress = strings.TrimSpace(v.GetString(flagLedgerAddr))
	cfg.LedgerInsecure = v.GetBool(flagLedgerInsecure)
	cfg.LedgerTimeout = v.GetDuration(flagLedgerTimeout)
	cfg.LedgerSecretKey = v.GetString(flagLedgerSecretKey)
	cfg.DefaultTenantID = strings.TrimSpace(v.GetString(flagDefaultTenant))
	cfg.DefaultLedgerID = strings.TrimSpace(v.GetString(flagDefaultLedger))
	cfg.AllowedOrigins = crosswordapi.ParseAllowedOrigins(v.GetString(flagAllowedOrigins))
	cfg.SessionSigningKey = v.GetString(flagJWTSigningKey)
	cfg.SessionIssuer = strings.TrimSpace(v.GetString(flagJWTIssuer))
	cfg.SessionCookieName = strings.TrimSpace(v.GetString(flagJWTCookieName))
	cfg.TAuthBaseURL = strings.TrimSpace(v.GetString(flagTAuthBaseURL))
	cfg.LLMProxyURL = strings.TrimSpace(v.GetString(flagLLMProxyURL))
	cfg.LLMProxyKey = v.GetString(flagLLMProxyKey)
	cfg.LLMProxyTimeout = v.GetDuration(flagLLMProxyTimeout)
	cfg.DatabaseDSN = v.GetString(flagDatabaseDSN)
	cfg.AdminEmails = crosswordapi.ParseAdminEmails(v.GetString(flagAdminEmails))
	cfg.BillingProvider = strings.TrimSpace(v.GetString(flagBillingProvider))
	cfg.PaddleEnvironment = strings.TrimSpace(v.GetString(flagPaddleEnv))
	cfg.PaddleAPIKey = v.GetString(flagPaddleAPIKey)
	cfg.PaddleAPIBaseURL = strings.TrimSpace(v.GetString(flagPaddleAPIBase))
	cfg.PaddleClientToken = v.GetString(flagPaddleClientTok)
	cfg.PaddleWebhookSecret = v.GetString(flagPaddleWebhook)
	cfg.PaddlePackPriceIDs = loadPaddlePackPriceIDsFromEnv(os.Environ())

	configFile, configPath, err := loadAppConfigFromPaths(defaultAppConfigPaths)
	if err != nil {
		return err
	}
	cfg.PublicConfigPath = strings.TrimSpace(configPath)
	cfg.AdminEmails = crosswordapi.MergeAdminEmails(cfg.AdminEmails, crosswordapi.ParseAdminEmails(strings.Join(configFile.Administrators, ",")))
	configFile.ApplyToRuntimeConfig(cfg)

	return cfg.Validate()
}

func loadAppConfigFromPaths(paths []string) (*crosswordapi.AppConfigFile, string, error) {
	for _, path := range paths {
		trimmedPath := strings.TrimSpace(path)
		if trimmedPath == "" {
			continue
		}

		configFile, err := crosswordapi.LoadAppConfigFile(trimmedPath)
		if err == nil {
			return configFile, trimmedPath, nil
		}
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		return nil, "", fmt.Errorf("load app config %s: %w", trimmedPath, err)
	}
	return &crosswordapi.AppConfigFile{}, "", nil
}

func loadAdminEmailsFromConfigPaths(paths []string) ([]string, error) {
	configFile, _, err := loadAppConfigFromPaths(paths)
	if err != nil {
		return nil, err
	}
	return crosswordapi.ParseAdminEmails(strings.Join(configFile.Administrators, ",")), nil
}

func loadPaddlePackPriceIDsFromEnv(environment []string) map[string]string {
	const envPrefixPackPriceID = "CROSSWORDAPI_PADDLE_PRICE_ID_PACK_"

	packPriceIDs := make(map[string]string)
	for _, rawEntry := range environment {
		key, value, ok := strings.Cut(rawEntry, "=")
		if !ok {
			continue
		}
		if !strings.HasPrefix(key, envPrefixPackPriceID) {
			continue
		}
		packCode := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(key, envPrefixPackPriceID)))
		packCode = strings.ReplaceAll(packCode, "__", "-")
		packCode = strings.ReplaceAll(packCode, "_", "-")
		if packCode == "" {
			continue
		}
		packPriceIDs[strings.ReplaceAll(packCode, "-", "_")] = strings.TrimSpace(value)
	}
	return packPriceIDs
}
