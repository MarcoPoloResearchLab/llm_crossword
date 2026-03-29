# TAuth Integration Guide

## Overview

TAuth is a multi-tenant authentication service built on Google Identity Services. It issues short-lived JWT session cookies and long-lived refresh tokens, providing a complete auth flow for browser-based applications.

**Module:** `github.com/tyemirov/tauth`
**Go Version:** 1.25.4

## Dependencies

| Dependency | Purpose |
|---|---|
| `github.com/gin-gonic/gin` v1.11.0 | HTTP router and middleware |
| `google.golang.org/api/idtoken` v0.258.0 | Google ID token verification |
| `github.com/golang-jwt/jwt/v5` v5.3.0 | HS256 JWT signing |
| `gorm.io/gorm` v1.31.1 | ORM (Postgres + SQLite) |
| `go.uber.org/zap` v1.27.1 | Structured logging |
| `github.com/spf13/cobra` v1.10.2 | CLI framework |
| `github.com/gin-contrib/cors` v1.7.6 | CORS middleware |

## API Endpoints

| Method | Path | Purpose | Response |
|---|---|---|---|
| POST | `/auth/nonce` | Issue single-use nonce for Google exchange | `200 { nonce }` |
| POST | `/auth/google` | Verify Google ID token, mint cookies | `200 { user_id, user_email, display, avatar_url, roles, expires }` |
| POST | `/auth/refresh` | Rotate refresh token, mint new access cookie | `204 No Content` |
| POST | `/auth/logout` | Revoke refresh token, clear cookies | `204 No Content` |
| GET | `/me` | Return authenticated user profile | `200 { profile }` or `401` |
| GET | `/tauth.js` | Serve embedded browser helper script | `200 JavaScript` |

## Configuration

**Config file:** YAML (default `config.yaml`)
**Override:** `--config=/path/to/config.yaml` or `TAUTH_CONFIG_FILE` env var

### Server-Level Configuration

```yaml
server:
  listen_addr: ":8080"
  database_url: "sqlite:///data/tauth.db"  # postgres:// or sqlite://
  enable_cors: false
  cors_allowed_origins: []
  cors_allowed_origin_exceptions: []
  enable_tenant_header_override: false  # dev/testing only
```

### Tenant Configuration (required per tenant)

```yaml
tenants:
  - id: "prod"
    display_name: "Production"
    tenant_origins:
      - "https://app.example.com"
    google_web_client_id: "client.apps.googleusercontent.com"
    jwt_signing_key: "secret-key"        # unique per tenant
    session_cookie_name: "app_session"
    refresh_cookie_name: "app_refresh"
    cookie_domain: ".example.com"
    session_ttl: "15m"
    refresh_ttl: "720h"
    nonce_ttl: "5m"
    allowed_users: []                    # empty = deny all, absent = allow all
    allow_insecure_http: false
```

Config supports shell-style variable expansion: `${VAR}` or `$VAR`.

## Cookies

Two HttpOnly, Secure cookies are issued:

1. **Session cookie** (`session_cookie_name`): Short-lived JWT (default 15m), Path `/`, SameSite Strict
2. **Refresh cookie** (`refresh_cookie_name`): Opaque long-lived token (default 720h), Path `/auth`, rotated on each refresh

## Core Interfaces

```go
// UserStore — persists and retrieves application users
type UserStore interface {
    UpsertGoogleUser(ctx context.Context, tenantID, googleSub, userEmail,
        userDisplayName, userAvatarURL string) (applicationUserID string, userRoles []string, err error)
    GetUserProfile(ctx context.Context, tenantID, applicationUserID string) (
        userEmail, userDisplayName, userAvatarURL string, userRoles []string, err error)
}

// RefreshTokenStore — manages long-lived refresh tokens
type RefreshTokenStore interface {
    Issue(ctx context.Context, tenantID, applicationUserID string,
        expiresUnix int64, previousTokenID string) (tokenID, tokenOpaque string, err error)
    Validate(ctx context.Context, tenantID, tokenOpaque string) (
        applicationUserID, tokenID string, expiresUnix int64, err error)
    Revoke(ctx context.Context, tenantID, tokenID string) error
}

// NonceStore — issues and validates single-use nonces
type NonceStore interface {
    Issue(ctx context.Context, tenantID string) (token string, err error)
    Consume(ctx context.Context, tenantID, token string) error
}
```

## Key Functions

```go
// Mount auth routes on a Gin router
func MountAuthRoutes(router gin.IRouter, registry TenantRegistry,
    users UserStore, refreshTokens RefreshTokenStore, nonces NonceStore)

// Session validation middleware for protected routes
func RequireSession(registry TenantRegistry) gin.HandlerFunc

// Mint a signed JWT access token
func MintAppJWT(clock Clock, tenantID, applicationUserID, userEmail,
    userDisplayName, userAvatarURL string, userRoles []string,
    issuer string, signingKey []byte, ttl time.Duration) (string, time.Time, error)

// Store constructors
func NewMemoryRefreshTokenStore() RefreshTokenStore
func NewDatabaseRefreshTokenStore(ctx context.Context, databaseURL string) (RefreshTokenStore, error)

// Dependency injection
func ProvideGoogleTokenValidator(validator GoogleTokenValidator)
func ProvideClock(clock Clock)
func ProvideLogger(logger *zap.Logger)
func ProvideMetrics(recorder MetricsRecorder)
```

## Downstream Service Integration (pkg/sessionvalidator)

For Go services that need to validate TAuth session tokens:

```go
import "github.com/tyemirov/tauth/pkg/sessionvalidator"

validator, err := sessionvalidator.New(sessionvalidator.Config{
    SigningKey:  []byte(os.Getenv("TAUTH_JWT_SIGNING_KEY")),
    CookieName: "app_session",
    Issuer:     "tauth",
})

// Protect Gin routes
router.Use(validator.GinMiddleware("auth_claims"))
router.GET("/api/me", func(c *gin.Context) {
    claims := c.MustGet("auth_claims").(*sessionvalidator.Claims)
    c.JSON(200, gin.H{"user_id": claims.UserID, "email": claims.UserEmail})
})
```

### Claims Structure

```go
type Claims struct {
    TenantID        string
    UserID          string
    UserEmail       string
    UserDisplayName string
    UserAvatarURL   string
    UserRoles       []string
    jwt.RegisteredClaims
}
```

## Browser Integration (tauth.js)

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
<script src="https://tauth.example.com/tauth.js"></script>
<script>
  initAuthClient({
    baseUrl: "https://tauth.example.com",
    tenantId: "optional-tenant-id",
    onAuthenticated(profile) {
      console.log("Signed in:", profile.user_email);
    },
    onUnauthenticated() {
      console.log("Signed out");
    }
  });
</script>
```

**Tenant override methods:**
- HTML attribute: `<script src="..." data-tenant-id="tenant-id"></script>`
- JavaScript: `setAuthTenantId("tenant-id")`
- Global: `window.__TAUTH_TENANT_ID__ = "tenant-id"`
- Document attribute: `<html data-tauth-tenant-id="tenant-id">`

**Features:**
- Fetches and hydrates session via `/me`
- Automatically refreshes expired tokens on 401
- Emits DOM events: `auth:authenticated`, `auth:unauthenticated`
- Coordinates across browser tabs via `BroadcastChannel`

## Request/Response Payloads

### POST `/auth/google`

Request:
```json
{ "google_id_token": "JWT from GIS", "nonce_token": "nonce from /auth/nonce" }
```

Response (200):
```json
{
  "user_id": "app-user-id",
  "user_email": "user@example.com",
  "display": "User Name",
  "avatar_url": "https://lh3.googleusercontent.com/...",
  "roles": ["user", "admin"]
}
```

### GET `/me`

Response (200):
```json
{
  "user_id": "app-user-id",
  "user_email": "user@example.com",
  "display": "User Name",
  "avatar_url": "https://...",
  "roles": ["user"],
  "expires": "2024-05-30T12:34:56.000Z"
}
```

### Error Response (4xx/5xx)

```json
{ "error": "error_code" }
```

Error codes: `invalid_json`, `missing_nonce`, `user_not_allowed`, `invalid_google_token`, `unverified_identity`, `https_required`

## CLI Commands

```bash
tauth [--config=/path/to/config.yaml]          # Start the service
tauth preflight --config=config.yaml            # Validate configuration
tauth doctor config.yaml --check-database       # Health check
tauth doctor config1.yaml config2.yaml --cross-validate --json  # CI/CD validation
```

## Database

GORM auto-migrates the `refresh_tokens` table. Tokens stored as SHA-256 hashes.

Supported backends:
- SQLite: `sqlite:///path/to/file.db`
- PostgreSQL: `postgres://user:pass@host:5432/db`

## Security Considerations

- Set `allow_insecure_http: false` in production (requires HTTPS termination)
- Nonce validation required for every Google Sign-In exchange (replay prevention)
- Refresh tokens rotated on each refresh; previous tokens revoked
- JWT signing keys must be unique per tenant and securely managed
- Cookie scoping: access cookies `SameSite=Strict`; refresh cookies scoped to `/auth`
- Only verified Google emails allowed (`email_verified` claim)
