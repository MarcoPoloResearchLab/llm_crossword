package crosswordapi

import "testing"

func TestValidateBillingAdditionalBranches(t *testing.T) {
	testCases := []struct {
		name   string
		mutate func(*Config)
	}{
		{
			name: "unsupported provider",
			mutate: func(cfg *Config) {
				cfg.BillingProvider = "stripe"
			},
		},
		{
			name: "blank pack code",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = []BillingPack{{Code: " ", Label: "Starter", Credits: 20, PriceCents: 2000}}
			},
		},
		{
			name: "blank pack label",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = []BillingPack{{Code: "starter", Label: " ", Credits: 20, PriceCents: 2000}}
			},
		},
		{
			name: "non-positive credits",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = []BillingPack{{Code: "starter", Label: "Starter", Credits: 0, PriceCents: 2000}}
			},
		},
		{
			name: "non-positive price",
			mutate: func(cfg *Config) {
				cfg.BillingPacks = []BillingPack{{Code: "starter", Label: "Starter", Credits: 20, PriceCents: 0}}
			},
		},
		{
			name: "missing api key",
			mutate: func(cfg *Config) {
				cfg.PaddleAPIKey = ""
			},
		},
		{
			name: "missing webhook secret",
			mutate: func(cfg *Config) {
				cfg.PaddleWebhookSecret = ""
			},
		},
	}

	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			cfg := validBillingConfig()
			testCase.mutate(&cfg)
			if err := cfg.Validate(); err == nil {
				t.Fatal("expected billing validation error")
			}
		})
	}
}

func TestNormalizedBillingPacksAndFindBillingPackCoverage(t *testing.T) {
	cfg := validBillingConfig()
	cfg.BillingPacks = []BillingPack{
		{Code: " Starter ", Label: " Starter Pack ", Credits: 20, PriceCents: 2000},
		{Code: " ", Label: "Skipped", Credits: 10, PriceCents: 1000},
	}

	packs := cfg.NormalizedBillingPacks()
	if len(packs) != 1 {
		t.Fatalf("expected only one normalized pack, got %#v", packs)
	}
	if packs[0].Code != "starter" || packs[0].Label != "Starter Pack" || packs[0].PriceDisplay != "$20.00" {
		t.Fatalf("unexpected normalized pack: %#v", packs[0])
	}

	if _, ok := cfg.FindBillingPack("   "); ok {
		t.Fatal("expected blank pack lookup to fail")
	}
	pack, ok := cfg.FindBillingPack("STARTER")
	if !ok {
		t.Fatal("expected normalized pack lookup to succeed")
	}
	if pack.Code != "starter" {
		t.Fatalf("unexpected found pack: %#v", pack)
	}
	if _, ok := cfg.FindBillingPack("missing"); ok {
		t.Fatal("expected unknown pack lookup to fail")
	}
}
