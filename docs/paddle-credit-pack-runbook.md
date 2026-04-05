# Paddle Credit-Pack Runbook

## Purpose

Use this runbook when configuring Paddle for one-time LLM Crossword credit packs.

The app expects:

- one active billing provider: `paddle`
- one app-owned default payment-link page: `/pay.html`
- webhook-driven credit settlement only

## Required Dashboard Setup

1. Create one Paddle price for each pack in `configs/config.yml`:
   - `starter`
   - `creator`
   - `publisher`
2. In Paddle `Checkout -> Checkout settings`, set the default payment link to:
   - local tunnel: `https://<your-public-host>/pay.html`
   - hosted: `https://llm-crossword.mprlab.com/pay.html`
3. Create one webhook destination per environment:
   - sandbox: `https://<your-public-host>/api/billing/paddle/webhook`
   - production: `https://llm-crossword.mprlab.com/api/billing/paddle/webhook`
4. Subscribe the webhook destination to:
   - `transaction.created`
   - `transaction.updated`
   - `transaction.completed`
5. Keep sandbox and production secrets separate.

## Required Env Vars

Set these in the crossword API profile file you are using, typically [configs/.env.crosswordapi.local](/Users/tyemirov/Development/llm_crossword/configs/.env.crosswordapi.local) for local work or [configs/.env.crosswordapi.production](/Users/tyemirov/Development/llm_crossword/configs/.env.crosswordapi.production) for production:

- `CROSSWORDAPI_BILLING_PROVIDER=paddle`
- `CROSSWORDAPI_PADDLE_ENVIRONMENT=sandbox|production`
- `CROSSWORDAPI_PADDLE_API_KEY`
- `CROSSWORDAPI_PADDLE_CLIENT_TOKEN`
- `CROSSWORDAPI_PADDLE_WEBHOOK_SECRET`
- These must be Paddle `price IDs`, not Paddle product IDs:
- `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_STARTER`
- `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_CREATOR`
- `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_PUBLISHER`

## Startup Validation

When billing is enabled, `crossword-api` validates the configured Paddle pack catalog during startup using live Paddle API calls.

Startup fails if:

- any configured pack price ID is missing in Paddle
- a configured price is not a one-time price
- the configured price amount does not match `configs/config.yml`

## Browser Runtime

Run:

```bash
cd /Users/tyemirov/Development/llm_crossword
./scripts/render-runtime-auth-config.sh
```

The generated runtime config only exposes:

- Paddle environment
- Paddle client token

It must never expose:

- API keys
- webhook secrets

## Local Sandbox

1. Start the crossword stack with sandbox billing env vars.
2. Expose the app through a public HTTPS tunnel.
3. Point Paddle sandbox webhook delivery at the tunnel URL.
4. Point the Paddle default payment link at the tunneled `/pay.html`.

## Smoke Test

1. Sign in and open the generator.
2. Click the header credit badge or exhaust credits and click `Buy credits`.
3. Confirm Settings -> Account shows pack cards and billing activity.
4. Start checkout and verify the app redirects to `/pay.html?...&_ptxn=txn_...`.
5. Complete a sandbox payment.
6. Verify the app returns to `/?billing_transaction_id=txn_...`.
7. Verify the header badge and Settings activity update after the webhook lands.

## Failure Map

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Checkout fails with `transaction_default_checkout_url_not_set` | Paddle default payment link is missing | Point Paddle Checkout settings at `/pay.html`. |
| Webhook returns `401` | wrong webhook secret or wrong environment | Match `CROSSWORDAPI_PADDLE_ENVIRONMENT` and the environment-specific webhook secret. |
| Credits never arrive after payment | webhook destination is not public HTTPS or not subscribed to `transaction.completed` | Fix the destination URL and enabled events. |
| API fails during startup with a catalog validation error | Paddle price IDs or amounts do not match the configured packs | Fix the Paddle catalog or the configured `CROSSWORDAPI_PADDLE_PRICE_ID_PACK_*` values, then restart. |
| `/pay.html` loads but checkout does not open | missing client token or wrong sandbox/production runtime config | Re-run `./scripts/render-runtime-auth-config.sh` with the correct env vars. |
