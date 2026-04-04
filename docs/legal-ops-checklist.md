# LLM Crossword Legal And Ops Checklist

This is an operational checklist for reducing founder-personal exposure while running LLM Crossword through Marco Polo Research Lab LLC.

## Public Product Surface

- Keep the operator name as `Marco Polo Research Lab LLC` on the homepage footer, checkout page, Privacy Policy, Terms of Service, and licensing text.
- Keep the production legal URLs stable:
  - `https://llm-crossword.mprlab.com/privacy.html`
  - `https://llm-crossword.mprlab.com/tos.html`
- Keep `support@mprlab.com` monitored and use it consistently across product, billing, and policy pages.

## OAuth And Google Identity

- In the Google Cloud OAuth consent screen, use the LLC-controlled product identity:
  - App name: `LLM Crossword`
  - Support email: LLC-controlled mailbox
  - Homepage: `https://llm-crossword.mprlab.com/`
  - Privacy Policy: `https://llm-crossword.mprlab.com/privacy.html`
  - Terms of Service: `https://llm-crossword.mprlab.com/tos.html`
- Verify the website in Google Search Console with an LLC-controlled/admin-shared account.
- Keep the OAuth project owned by an LLC-controlled Google account or shared admin group, not one personal account only.
- Do not store OAuth client-secret JSON files inside the served repo root. This repo's local `ghttp` setup serves the repository root.

## Billing And Paddle

- In Paddle, use `Marco Polo Research Lab LLC` as the seller identity for this product.
- Keep the statement descriptor recognizable to buyers and aligned with the site/product name.
- Keep the refund policy on the site and the refund settings/process in Paddle aligned.
- Keep the Merchant of Record disclosure in the Terms current for Paddle-processed purchases.
- Confirm Paddle buyer-support requirements are satisfied with real support contact details. If Paddle requires a phone number for your flow or account tier, publish an LLC-controlled support number instead of a personal number.

## Admin And Internal Access

- Do not put administrator emails in `configs/config.yml`; that file is client-readable through the public `/config.yml` route.
- Set admin allowlists through `CROSSWORDAPI_ADMIN_EMAILS` in `configs/.env.crosswordapi.local`, `configs/.env.crosswordapi.production`, or another server-side secret source.
- Prefer role-based admin assignment in TAuth or a shared company mailbox/group over one personal Gmail account.

## Infrastructure Ownership

- Prefer LLC-controlled domains, DNS, email mailboxes, payment accounts, analytics properties, and cloud projects.
- If the `ghcr.io/tyemirov/*` container images become distribution-facing, move them to an LLC/org-controlled registry namespace.
- Keep support, billing, and incident response mailboxes under company control so access survives personnel or account changes.

## Corporate Separation

- Run revenue and expenses through LLC bank and payment accounts.
- Use the LLC name on invoices, receipts, contracts, and customer-facing notices.
- Keep California LLC filings, tax registrations, and any annual/biennial state requirements current.
- If you want to reduce public exposure of your personal home address/name as agent, handle that through state filing updates or a registered-agent service, not through repo text.

## Repo Hygiene

- Keep `configs/.env.crosswordapi.local`, `configs/.env.crosswordapi.production`, `configs/.env.tauth.local`, `configs/.env.tauth.production`, and any credential exports untracked.
- Rotate any OAuth client secret that has ever lived in a served directory or been copied to a deployed machine image.
- Review public config and static files before deploy for personal emails, home addresses, personal phone numbers, and personal usernames.
