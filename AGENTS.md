# AGENTS.md

## Repo Focus

This repository is for **LLM Crossword**, not the allergy-wheel game.

- Frontend: browser-based crossword UI in `index.html`, `pay.html`, `js/*.js`, and `css/crossword.css`
- Backend: Go API in `backend/cmd/crossword-api` and `backend/internal/crosswordapi`
- Auth and service routing: browser runtime config in `js/runtime-auth-config*.js` plus `js/service-config.js`

## Current Deployment Shape

- The browser app may run split-origin.
- The backend is available at `https://llm-crossword-api.mprlab.com`.
- The browser-facing API base should point to `https://llm-crossword-api.mprlab.com` unless a task explicitly changes the runtime override setup.
- TAuth may be hosted separately, so frontend code should use the runtime service config helpers instead of hardcoding same-origin assumptions.

## Working Rules

### 1. Stay on Product

- Keep work scoped to the crossword generator, puzzle solving UI, auth, sharing, billing, and related backend endpoints.
- Do not replace the app with unrelated demos, games, or alternate products.

### 2. Match Existing Code Style

- Follow the style of the file you touch.
- The current frontend is mostly browser-native JavaScript with IIFEs and `"use strict"`, not an ES-module-only app.
- Prefer descriptive names, small helpers, and shared constants for repeated values.
- Use `Object.freeze` where the existing codebase uses it for config-like structures.

### 3. Service URLs

- Route browser-facing API/auth/config/script URLs through the runtime service config layer.
- Prefer `window.LLMCrosswordServices.buildApiUrl(...)`, `buildAuthUrl(...)`, `getConfigUrl()`, and `getTauthScriptUrl()` where applicable.
- Preserve split-origin compatibility when changing fetches, redirects, or script/config loading.

### 4. Frontend Boundaries

- Keep DOM orchestration in the browser app files under `js/`.
- Keep auth/bootstrap/runtime wiring in the existing frontend entrypoints instead of introducing parallel app shells without a clear reason.
- Preserve the current landing page, puzzle view, billing flow, and share flow unless the task explicitly changes them.

### 5. Backend Boundaries

- Keep API behavior in `backend/internal/crosswordapi`.
- Keep CLI/config bootstrapping in `backend/cmd/crossword-api`.
- When changing public endpoints or response shapes, update tests alongside the code.

### 6. Business-Critical Billing Paths

- Treat billing as a fail-closed system. Checkout, portal access, webhook processing, reconciliation, and customer-link resolution are business-critical paths.
- Do not add defensive fallbacks, heuristic recovery, optimistic UI unlocks, or alternate identity guesses on billing-critical paths.
- If required billing data is missing, stale, or inconsistent, the correct behavior is to return an error and leave the path blocked until the underlying issue is fixed.
- In particular, do not bypass persisted billing-customer linkage requirements with email-based or other inferred portal fallbacks unless the product requirements explicitly change.

### 7. Testing

- Frontend/browser coverage lives primarily in Playwright under `tests/e2e`.
- Backend coverage lives in Go tests under `backend/...`.
- Prefer targeted verification for the area you changed before broader suites.

### 8. Documentation

- Keep README and runtime/deployment docs aligned with the actual frontend/backend topology.
- If deployment defaults change, update the related config docs in the same change.
