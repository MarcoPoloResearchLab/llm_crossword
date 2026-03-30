# LLM Crossword Paddle Credit-Pack Guide

## Purpose

- Wire one-time Paddle credit-pack purchases into the existing Ledger-backed credit model.
- Keep Paddle-specific checkout, portal, and webhook behavior inside the billing adapter.
- Keep credit settlement inside the app-owned Ledger boundary.

## Inputs

- Exact literals:
  - provider: `paddle`
  - public routes:
    - `/api/billing/summary`
    - `/api/billing/checkout`
    - `/api/billing/portal`
    - `/api/billing/paddle/webhook`
    - `/pay.html`
  - cookie name: `app_session`
  - webhook events:
    - `transaction.created`
    - `transaction.updated`
    - `transaction.completed`
  - browser return query key: `billing_transaction_id`
- Required config keys:
  - repo config: `billing.packs[]`
  - env vars:
    - `CROSSWORDAPI_BILLING_PROVIDER`
    - `CROSSWORDAPI_PADDLE_ENVIRONMENT`
    - `CROSSWORDAPI_PADDLE_API_KEY`
    - `CROSSWORDAPI_PADDLE_CLIENT_TOKEN`
    - `CROSSWORDAPI_PADDLE_WEBHOOK_SECRET`
    - `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_<PACK_CODE>`
- Files to touch:
  - [configs/config.yml](/Users/tyemirov/Development/llm_crossword/configs/config.yml)
  - [.env.crosswordapi.example](/Users/tyemirov/Development/llm_crossword/.env.crosswordapi.example)
  - [backend/cmd/crossword-api/main.go](/Users/tyemirov/Development/llm_crossword/backend/cmd/crossword-api/main.go)
  - [backend/internal/crosswordapi/config.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/config.go)
  - [backend/internal/crosswordapi/billing_service.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/billing_service.go)
  - [backend/internal/crosswordapi/billing_paddle.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/billing_paddle.go)
  - [backend/internal/crosswordapi/store.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/store.go)
  - [backend/internal/crosswordapi/server.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/server.go)
  - [scripts/render-runtime-auth-config.sh](/Users/tyemirov/Development/llm_crossword/scripts/render-runtime-auth-config.sh)
  - [index.html](/Users/tyemirov/Development/llm_crossword/index.html)
  - [js/billing.js](/Users/tyemirov/Development/llm_crossword/js/billing.js)
  - [js/app.js](/Users/tyemirov/Development/llm_crossword/js/app.js)
  - [js/admin.js](/Users/tyemirov/Development/llm_crossword/js/admin.js)
  - [pay.html](/Users/tyemirov/Development/llm_crossword/pay.html)
  - [tests/e2e/billing.spec.js](/Users/tyemirov/Development/llm_crossword/tests/e2e/billing.spec.js)

| Input | Consumed by | Type | Required locally | Required when hosted | Notes |
| --- | --- | --- | --- | --- | --- |
| `billing.packs[]` | backend + UI | repo config | yes | yes | One source of truth for pack labels, credits, and display prices. |
| `CROSSWORDAPI_PADDLE_*` | backend | internal | yes | yes | Secrets stay server-side except the client token exposed by runtime config. |
| `/pay.html` | browser + Paddle | browser-facing | yes | yes | Must be the Paddle default payment-link page. |
| `/api/billing/paddle/webhook` | Paddle | public HTTPS | yes | yes | Sandbox can point at a tunnel; production must point at the hosted origin. |
| Ledger grant idempotency key `billing:paddle:<event_id>` | backend + Ledger | internal | yes | yes | Prevents double-crediting duplicate webhook deliveries. |

## Source Of Truth

- [docs/paddle-credit-pack-runbook.md](/Users/tyemirov/Development/llm_crossword/docs/paddle-credit-pack-runbook.md)
- [configs/config.yml](/Users/tyemirov/Development/llm_crossword/configs/config.yml)
- [.env.crosswordapi.example](/Users/tyemirov/Development/llm_crossword/.env.crosswordapi.example)
- [backend/internal/crosswordapi/billing_service.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/billing_service.go)
- [backend/internal/crosswordapi/billing_paddle.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/billing_paddle.go)
- [backend/internal/crosswordapi/server.go](/Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/server.go)
- [js/billing.js](/Users/tyemirov/Development/llm_crossword/js/billing.js)
- [pay.html](/Users/tyemirov/Development/llm_crossword/pay.html)
- [tests/e2e/billing.spec.js](/Users/tyemirov/Development/llm_crossword/tests/e2e/billing.spec.js)

## Decision Procedure

1. Read [configs/config.yml](/Users/tyemirov/Development/llm_crossword/configs/config.yml) and fail if `billing.packs[]` is missing or any pack has a blank `code`, blank `label`, non-positive `credits`, or non-positive `price_cents`.
2. Read [.env.crosswordapi.example](/Users/tyemirov/Development/llm_crossword/.env.crosswordapi.example) and fail if the deployment cannot choose one explicit provider with `CROSSWORDAPI_BILLING_PROVIDER=paddle`.
3. If `CROSSWORDAPI_PADDLE_ENVIRONMENT` is not `sandbox` or `production`, stop and report instead of guessing.
4. For every configured pack code, require one `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_<PACK_CODE>` env var. If any pack is missing a price ID, stop and report.
5. Wire the backend billing service so Paddle webhook parsing yields exactly one canonical `BillingGrantEvent` before Ledger settlement.
6. Persist customer links and billing events before rendering UI activity. Use event uniqueness and Ledger idempotency together; do not grant credits from browser success handlers.
7. Render browser-safe Paddle config only through [scripts/render-runtime-auth-config.sh](/Users/tyemirov/Development/llm_crossword/scripts/render-runtime-auth-config.sh). Expose the client token and environment only.
8. Use [pay.html](/Users/tyemirov/Development/llm_crossword/pay.html) as the app-owned default payment-link page. Read `_ptxn`, initialize Paddle.js, open checkout for that transaction, and redirect back to `/?billing_transaction_id=<txn_id>` when checkout closes or completes.
9. Wire the frontend entry points in [index.html](/Users/tyemirov/Development/llm_crossword/index.html), [js/app.js](/Users/tyemirov/Development/llm_crossword/js/app.js), [js/admin.js](/Users/tyemirov/Development/llm_crossword/js/admin.js), and [js/billing.js](/Users/tyemirov/Development/llm_crossword/js/billing.js):
   - clickable header credit badge
   - insufficient-credits `Buy credits` CTA
   - Settings -> Account pack list, balance, activity, and portal entry
   - checkout-return drawer restore plus summary polling
10. Run the backend and browser verification commands. If any command fails, classify the failure using `guide defect`, `agent defect`, or `environment defect` from the shared quality rubric.

## Expected Result

- `GET /api/billing/summary` returns the current balance, pack catalog, recent activity, and portal availability for the signed-in user.
- `POST /api/billing/checkout` returns a transaction id plus a checkout URL that lands on `/pay.html`.
- `POST /api/billing/paddle/webhook` verifies signatures and settles successful purchases into Ledger exactly once.
- Settings -> Account renders the pack cards and billing activity.
- Returning from checkout refreshes the badge and shows payment confirmation once the webhook has been processed.

## Verification

```bash
cd /Users/tyemirov/Development/llm_crossword

./scripts/render-runtime-auth-config.sh

cd /Users/tyemirov/Development/llm_crossword/backend
go test ./...

cd /Users/tyemirov/Development/llm_crossword
npx playwright test tests/e2e/billing.spec.js --reporter=line
npx playwright test tests/e2e/app-auth.spec.js --reporter=line

rg -n 'billing:' /Users/tyemirov/Development/llm_crossword/configs/config.yml
rg -n '/api/billing/(summary|checkout|portal|paddle/webhook)' /Users/tyemirov/Development/llm_crossword/backend/internal/crosswordapi/server.go
rg -n 'billing_transaction_id|Buy credits|Manage billing' /Users/tyemirov/Development/llm_crossword/index.html /Users/tyemirov/Development/llm_crossword/js
```

## Failure Map

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Checkout returns `billing_checkout_missing` | Paddle default payment link is not set to `/pay.html` | Update Paddle Checkout settings and retry. |
| Webhook returns `401 invalid webhook signature` | wrong webhook secret or wrong environment pairing | Match the sandbox/production secret to `CROSSWORDAPI_PADDLE_ENVIRONMENT`. |
| Credits are granted twice | idempotency is missing before or during settlement | Enforce unique `event_id` storage and keep Ledger idempotency key `billing:paddle:<event_id>`. |
| UI shows packs but badge never updates after payment | webhook did not land or poll never observed `transaction.completed` | Fix webhook reachability first, then verify checkout-return polling. |
| Browser checkout loads with no overlay | missing client token or broken runtime config generation | Re-run `./scripts/render-runtime-auth-config.sh` and inspect `LLMCrosswordRuntimeConfig.billing`. |

## Stop Rules

- Stop if the deployment cannot select one active billing provider.
- Stop if a required Paddle secret, client token, or price id is missing.
- Stop if the fix would grant credits directly from browser code without waiting for a verified webhook.
- Stop if the default payment link cannot be pointed at `/pay.html` on a public HTTPS origin.

## Change Checklist

- [ ] `billing.packs[]` is present and valid in repo config.
- [ ] Paddle env vars and per-pack price IDs are explicit.
- [ ] Backend routes, adapter, storage, and settlement are wired.
- [ ] Browser runtime config exposes only the safe Paddle values.
- [ ] Settings -> Account renders balance, packs, activity, and portal access.
- [ ] Checkout return restores the drawer and refreshes credit state.
- [ ] Backend Go tests pass.
- [ ] Browser billing tests pass.
