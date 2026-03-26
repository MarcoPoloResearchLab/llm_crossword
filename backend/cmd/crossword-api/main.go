package main

import (
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
	envPrefix           = "CROSSWORDAPI"
)

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
	os.Exit(run())
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

	cmd.Flags().String(flagListenAddr, "", "HTTP listen address")
	cmd.Flags().String(flagLedgerAddr, "", "ledger gRPC address")
	cmd.Flags().Bool(flagLedgerInsecure, false, "use insecure ledger connection")
	cmd.Flags().Duration(flagLedgerTimeout, 0, "ledger RPC timeout")
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

	return cmd
}

func loadConfig(cmd *cobra.Command, cfg *crosswordapi.Config) error {
	v := viper.New()
	v.SetEnvPrefix(envPrefix)
	v.SetEnvKeyReplacer(strings.NewReplacer("-", "_"))
	v.AutomaticEnv()

	allFlags := []string{
		flagListenAddr, flagLedgerAddr, flagLedgerInsecure, flagLedgerTimeout,
		flagDefaultTenant, flagDefaultLedger, flagAllowedOrigins,
		flagJWTSigningKey, flagJWTIssuer, flagJWTCookieName, flagTAuthBaseURL,
		flagLLMProxyURL, flagLLMProxyKey, flagLLMProxyTimeout,
	}
	for _, flagName := range allFlags {
		if err := v.BindPFlag(flagName, cmd.Flags().Lookup(flagName)); err != nil {
			return err
		}
	}

	required := []string{
		flagListenAddr, flagLedgerAddr, flagLedgerInsecure, flagLedgerTimeout,
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

	return cfg.Validate()
}
