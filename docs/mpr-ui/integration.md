# mpr-ui Integration Guide

## Overview

mpr-ui is a reusable UI component library delivered as a CDN-hosted JavaScript bundle. It provides custom Web Components for authentication, navigation, theming, and layout without requiring build tools or frameworks.

**Package:** `mpr-ui`
**Version:** 2.0.2
**License:** MIT

## Assets

| File | Purpose | Size |
|---|---|---|
| `mpr-ui.js` | Main production bundle, registers custom elements to `window.MPRUI` | 438 KB |
| `mpr-ui-config.js` | Configuration loader for YAML-based environment management | — |
| `mpr-ui.css` | Global styles with theme variables and component styles | 13 KB |

## Script Loading Order

Load scripts in this exact order:

```html
<!-- 1. CSS -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.8.2/mpr-ui.css" />

<!-- 2. TAuth helper -->
<script defer src="https://tauth.mprlab.com/tauth.js"></script>

<!-- 3. Google Identity Services -->
<script src="https://accounts.google.com/gsi/client" async defer></script>

<!-- 4. YAML parser -->
<script src="https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js"></script>

<!-- 5. Config loader -->
<script src="https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.8.2/mpr-ui-config.js"></script>

<!-- 6. Load config then bundle -->
<script>
  (function() {
    function loadMprUi() {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/gh/MarcoPoloResearchLab/mpr-ui@v3.8.2/mpr-ui.js';
      document.head.appendChild(s);
    }
    MPRUI.applyYamlConfig({ configUrl: '/config.yaml' })
      .then(loadMprUi)
      .catch(function(err) { console.error('Config failed:', err); });
  })();
</script>
```

**Critical:** Config must be applied **before** `mpr-ui.js` loads so auth attributes are set when components initialize.

## YAML Configuration

Create `config.yaml` at your application root:

```yaml
environments:
  - description: "Production"
    origins:
      - "https://myapp.example.com"
    auth:
      tauthUrl: "https://tauth.example.com"  # or "" for same-origin
      googleClientId: "CLIENT_ID.apps.googleusercontent.com"
      tenantId: "my-tenant"
      loginPath: "/auth/google"
      logoutPath: "/auth/logout"
      noncePath: "/auth/nonce"
    authButton:
      text: "signin_with"
      size: "large"
      theme: "outline"
      shape: "circle"

  - description: "Development"
    origins:
      - "https://localhost:4443"
    auth:
      tauthUrl: ""
      googleClientId: "CLIENT_ID.apps.googleusercontent.com"
      tenantId: "my-tenant"
      loginPath: "/auth/google"
      logoutPath: "/auth/logout"
      noncePath: "/auth/nonce"
    authButton:
      text: "signin_with"
      size: "large"
      theme: "outline"
```

Environment matching uses `window.location.origin`. Each origin must appear in exactly one environment.

## Global Namespace (window.MPRUI)

| Export | Type | Description |
|---|---|---|
| `createAuthHeader(host, options)` | function | Creates auth header controller |
| `renderAuthHeader(selector, options)` | function | Convenience wrapper resolving CSS selectors |
| `configureTheme(config)` | function | Merges global theme configuration |
| `setThemeMode(value)` | function | Sets active theme mode |
| `getThemeMode()` | function | Returns active theme mode |
| `onThemeChange(listener)` | function | Subscribes to theme updates; returns unsubscribe |
| `getFooterSiteCatalog()` | function | Returns footer links array |
| `getBandProjectCatalog()` | function | Returns project cards for `<mpr-band>` |
| `createSelectionState()` | function | Headless multi-select helper |
| `createCustomElementRegistry()` | function | Guards `customElements.define` for multiple loads |
| `MprElement` | class | Base class for all custom elements |

## Custom Elements

### `<mpr-header>` — Authentication & Navigation Banner

**Auth attributes (set from config.yaml):**
- `google-site-id` — Google OAuth Web client ID
- `tauth-tenant-id` — TAuth tenant identifier
- `tauth-login-path`, `tauth-logout-path`, `tauth-nonce-path` — Auth endpoints
- `tauth-url` — TAuth service URL (`""` for same-origin)

**Optional attributes:**
- `brand-label`, `brand-href` — Brand text and link
- `nav-links` — JSON: `[{ label, href, target? }]`
- `horizontal-links` — JSON: `{ alignment, links: [...] }`
- `sticky` — `"true"` or `"false"` (default: `"true"`)
- `user-menu-display-mode` — `"avatar"` | `"avatar-name"` | `"avatar-full-name"`

**Slots:** `brand`, `nav-left`, `nav-right`, `aux`

**Data attributes set on auth:** `data-user-id`, `data-user-email`, `data-user-display`, `data-user-avatar-url`

**Events:**
- `mpr-ui:auth:authenticated` — `{ profile }`
- `mpr-ui:auth:unauthenticated`
- `mpr-ui:auth:error` — `{ code, message? }`

### `<mpr-footer>` — Footer with Theme Toggle

**Attributes:** `prefix-text`, `links-collection` (JSON), `horizontal-links` (JSON), `privacy-link-href`, `privacy-link-label`, `privacy-modal-content`, `theme-switcher` (`"toggle"` | `"square"` | `"button"`), `sticky`, `size` (`"normal"` | `"small"`)

**Slots:** `menu-prefix`, `menu-links`, `legal`

### `<mpr-login-button>` — Standalone Google Sign-In

**Attributes:** `site-id`, `tauth-tenant-id`, `tauth-login-path`, `tauth-logout-path`, `tauth-nonce-path`, `tauth-url`, `button-text`, `button-size`, `button-theme`, `button-shape`

### `<mpr-user>` — Profile Menu

**Attributes:** `display-mode` (`"avatar"` | `"avatar-name"` | `"name"`), `logout-url`, `logout-label`, `tauth-tenant-id`, `avatar-url`

**Events:** `mpr-user:toggle`, `mpr-user:logout`, `mpr-user:menu-item`

### `<mpr-workspace-layout>` — Two-Region Layout

**Attributes:** `sidebar-width`, `collapsed`, `stacked-breakpoint`

**Slots:** `header`, `sidebar`, `content` (default)

### `<mpr-sidebar-nav>` — Sidebar Navigation

**Attributes:** `label`, `dense`, `variant`

Supply items with `data-mpr-sidebar-key` attribute. Emits `mpr-sidebar-nav:change` with key.

### `<mpr-band>` — Themed Horizontal Container

**Attributes:** `category` (`"research"` | `"tools"` | `"platform"` | `"products"` | `"custom"`), `theme` (JSON color overrides)

### `<mpr-card>` — Project/Product Card

**Attributes:** `card` (JSON: `{ id, title, description, status, url }`), `theme`

**Events:** `mpr-card:card-toggle`, `mpr-card:subscribe-ready`

### `<mpr-theme-toggle>` — Standalone Theme Switcher

**Attributes:** `variant` (`"switch"` | `"button"` | `"square"`), `label`, `show-label`, `theme-config`

### `<mpr-settings>` — Settings Panel

**Attributes:** `label`, `icon`, `panel-id`, `open`

## Authentication Flow

1. **Init**: Config loader sets auth attributes on components
2. **Bootstrap**: TAuth helper (`initAuthClient`) recovers existing session
3. **GIS Ready**: Google Identity Services initialized with client ID
4. **Credential Exchange**: GIS callback → nonce request → credential exchange
5. **Events**: `mpr-ui:auth:authenticated` dispatched with profile
6. **Logout**: POST to logout endpoint → session cleared

### Listening to Auth Events

```javascript
document.addEventListener('mpr-ui:auth:authenticated', (event) => {
    const profile = event.detail?.profile;
    console.log('Signed in:', profile?.email);
});

document.addEventListener('mpr-ui:auth:unauthenticated', () => {
    console.log('Signed out');
});
```

## Theme System

### CSS Variables

```css
:root {
    --mpr-color-surface-primary: rgba(248, 250, 252, 0.95);
    --mpr-color-surface-elevated: rgba(255, 255, 255, 0.98);
    --mpr-color-text-primary: #0f172a;
    --mpr-color-text-muted: #475569;
    --mpr-color-border: rgba(148, 163, 184, 0.35);
    --mpr-color-accent: #0ea5e9;
    --mpr-color-accent-alt: #22c55e;
}
```

Dark mode: `[data-mpr-theme='dark']` selector overrides variables.

### Theme Manager API

```javascript
MPRUI.configureTheme({
    attribute: "data-mpr-theme",
    targets: ["document", "body"],
    modes: [
        { value: "light", attributeValue: "light" },
        { value: "dark", attributeValue: "dark" }
    ],
    initialMode: "light"
});

MPRUI.setThemeMode("dark");
MPRUI.onThemeChange((mode) => console.log("Theme:", mode));
```

## Config Loader API (mpr-ui-config.js)

| Function | Purpose |
|---|---|
| `MPRUI.loadYamlConfig(options)` | Loads and parses config.yaml |
| `MPRUI.applyYamlConfig(options)` | Loads config and applies auth attributes to DOM |
| `MPRUI.whenAutoOrchestrationReady()` | Waits for auto-orchestration to complete |

**Events:** `mpr-ui:config:applied`, `mpr-ui:bundle:loaded`, `mpr-ui:orchestration:ready`

## Usage Example

```html
<mpr-header brand-label="My App" brand-href="/" data-config-url="/config.yaml">
    <mpr-user slot="aux" display-mode="avatar" logout-url="/" logout-label="Log out"></mpr-user>
</mpr-header>

<main><!-- Your content --></main>

<mpr-footer
    prefix-text="Built by My Team"
    privacy-link-href="/privacy"
    theme-switcher="toggle"
    sticky="true"
></mpr-footer>
```

## Common Integration Patterns

1. **Same-origin auth**: Set `tauthUrl: ""` in config.yaml; reverse-proxy TAuth endpoints
2. **Cross-origin auth**: Set `tauthUrl: "https://tauth.example.com"`
3. **Multiple tenants**: Recreate header/login-button (never mutate `tauth-tenant-id`)
4. **Custom CSS**: Use `--mpr-color-*` variables
5. **Framework integration**: Use Web Components DSL (declarative) or `MPRUI.createAuthHeader` (imperative)

## Troubleshooting

| Issue | Fix |
|---|---|
| Sign-in button doesn't appear | Check GIS script loaded; verify CDN |
| Config error: "no environment for origin" | Add `window.location.origin` to config.yaml |
| Session doesn't persist | Verify TAuth cookie domain matches app domain |
| CORS errors during nonce/login | Add origin to TAuth CORS config |
| Theme doesn't apply | Check theme-config `targets` selectors exist |
| Bundle loads twice | Use `createCustomElementRegistry()` to guard definitions |
