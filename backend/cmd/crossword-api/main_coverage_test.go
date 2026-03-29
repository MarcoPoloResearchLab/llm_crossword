package main

import "testing"

func TestLoadPaddlePackPriceIDsFromEnvCoverage(t *testing.T) {
	result := loadPaddlePackPriceIDsFromEnv([]string{
		"MALFORMED",
		"OTHER_ENV=value",
		"CROSSWORDAPI_PADDLE_PRICE_ID_PACK_=ignored",
		"CROSSWORDAPI_PADDLE_PRICE_ID_PACK_STARTER= pri_starter ",
		"CROSSWORDAPI_PADDLE_PRICE_ID_PACK_PRO__PLUS=pri_pro_plus",
		"CROSSWORDAPI_PADDLE_PRICE_ID_PACK_TEAM_PACK=pri_team_pack",
	})

	if len(result) != 3 {
		t.Fatalf("expected 3 parsed pack price ids, got %#v", result)
	}
	if result["starter"] != "pri_starter" {
		t.Fatalf("unexpected starter price id map: %#v", result)
	}
	if result["pro_plus"] != "pri_pro_plus" {
		t.Fatalf("unexpected pro_plus price id map: %#v", result)
	}
	if result["team_pack"] != "pri_team_pack" {
		t.Fatalf("unexpected team_pack price id map: %#v", result)
	}
}
