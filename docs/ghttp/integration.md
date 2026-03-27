# gHTTP Integration Guide

## Overview

gHTTP is a single-process file server with reverse proxy, Markdown rendering, WebSocket support, and configurable response policies.

**Module:** `github.com/tyemirov/ghttp`
**Go Version:** 1.25.4

## Dependencies

| Dependency | Purpose |
|---|---|
| `github.com/gorilla/websocket` v1.5.3 | WebSocket upgrade handling |
| `github.com/spf13/cobra` v1.10.2 | CLI framework |
| `github.com/spf13/viper` v1.21.0 | Configuration management |
| `github.com/yuin/goldmark` v1.7.13 | Markdown-to-HTML rendering |
| `go.uber.org/zap` v1.27.1 | Structured logging |

## Architecture

Request pipeline (inside-out composition):

```
http.FileServer (base)
  → Markdown or Directory Guard (optional)
  → Browse Handler (optional)
  → Initial File Handler (optional)
  → Proxy Handler (optional)
  → Response Headers (Server: ghttpd, Connection: close for HTTP/1.0)
  → Route Response Policy Handler
  → Request Logging (CONSOLE or JSON)
```

## Configuration

### Precedence (highest first)

1. CLI flags and positional argument
2. Environment variables (`GHTTP_` prefix)
3. Configuration file (`~/.config/ghttp/config.yaml` or `--config`)
4. Built-in defaults

### CLI Flags and Environment Variables

| Flag | Env Variable | Default | Notes |
|---|---|---|---|
| `PORT` (positional) | `GHTTP_SERVE_PORT` | `8000` (HTTP), `8443` (HTTPS) | Port or Unix socket path |
| `--config` | `GHTTP_CONFIG_FILE` | `~/.config/ghttp/config.yaml` | Config file path |
| `--bind` | `GHTTP_SERVE_BIND_ADDRESS` | (all interfaces) | IP to bind |
| `--directory` | `GHTTP_SERVE_DIRECTORY` | `.` | Directory to serve |
| `--protocol` | `GHTTP_SERVE_PROTOCOL` | `HTTP/1.1` | `HTTP/1.0` or `HTTP/1.1` |
| `--no-md` | `GHTTP_SERVE_NO_MARKDOWN` | `false` | Disable Markdown rendering |
| `--browse` | `GHTTP_SERVE_BROWSE` | `false` | Always list directories |
| `--logging-type` | `GHTTP_SERVE_LOGGING_TYPE` | `CONSOLE` | `CONSOLE` or `JSON` |
| `--proxy` | `GHTTP_SERVE_PROXIES` | — | Repeatable; comma-separated in env |
| `--response-header` | `GHTTP_SERVE_RESPONSE_HEADERS` | — | Repeatable; comma-separated in env |
| `--proxy-streaming` | `GHTTP_SERVE_PROXY_STREAMING` | — | Repeatable; comma-separated in env |
| `--https` | `GHTTP_SERVE_HTTPS` | `false` | Self-signed HTTPS |
| `--https-host` | `GHTTP_HTTPS_HOSTS` | `localhost,127.0.0.1,::1` | SANs for cert |
| `--tls-cert` | `GHTTP_SERVE_TLS_CERTIFICATE` | — | Existing cert path |
| `--tls-key` | `GHTTP_SERVE_TLS_PRIVATE_KEY` | — | Existing key path |

Additional: `GHTTPD_DISABLE_DIR_INDEX=1` suppresses directory listings.

### YAML Configuration File

```yaml
serve:
  bind_address: ""
  directory: "."
  port: "8000"
  protocol: "HTTP/1.1"
  tls_certificate: ""
  tls_private_key: ""
  no_markdown: false
  browse: false
  https: false
  logging_type: "CONSOLE"
  proxies:
    - "/api=http://backend:8081"
    - "/ws=http://websocket:9000"
  response_headers:
    - "/=Cache-Control:no-store"
    - "/assets/=Cache-Control:public, max-age=31536000"
  proxy_streaming:
    - "/api/events=unbuffered"

https:
  certificate_directory: "~/.config/ghttp/certs"
  hosts:
    - "localhost"
    - "127.0.0.1"
    - "::1"
```

## Exported Types

### FileServerConfiguration

```go
type FileServerConfiguration struct {
    BindAddress             string
    Port                    string
    DirectoryPath           string
    ProtocolVersion         string                // "HTTP/1.0" or "HTTP/1.1"
    DisableDirectoryListing bool
    EnableMarkdown          bool
    BrowseDirectories       bool
    InitialFileRelativePath string                // startup file (html/htm/md)
    LoggingType             string                // "CONSOLE" or "JSON"
    TLS                     *TLSConfiguration
    ProxyRoutes             ProxyRoutes
    RouteResponsePolicies   RouteResponsePolicies
    ProxyStreamingPolicies  ProxyStreamingPolicies
}
```

### Proxy Routes

```go
routes, err := server.NewProxyRoutes([]string{
    "/api=http://backend:8081",
    "/ws=http://websocket:9000",
})
```

Format: `/pathprefix=http://backend:port` — sorted longest-prefix-first for deterministic matching. WebSocket upgrades are automatically proxied.

### Response Header Policies

```go
policies, err := server.NewRouteResponsePolicies([]string{
    "/=Cache-Control:no-store",
    "/assets/=Cache-Control:public, max-age=31536000, immutable",
})
headers := policies.HeadersForPath("/api/data")  // map[string]string
```

### Proxy Streaming Policies

```go
policies, err := server.NewProxyStreamingPolicies([]string{
    "/api/events=unbuffered",  // SSE/chunked — flush immediately
    "/api/data=buffered",       // normal response buffering
})
isUnbuffered := policies.IsUnbuffered("/api/events")
```

## Key Functions

```go
// Create a new server
func NewFileServer(loggingService *logging.Service,
    servingAddressFormatter serverdetails.ServingAddressFormatter) FileServer

// Start serving (blocks until context cancelled or error)
func (fileServer FileServer) Serve(ctx context.Context,
    configuration FileServerConfiguration) error

// CLI entrypoint
func Execute(ctx context.Context, arguments []string) int
```

## Logging

```go
service, err := logging.NewService(logging.TypeConsole)  // or logging.TypeJSON
service.Info("message", logging.String("key", "value"))
service.Error("message", err)
service.Sync()
```

**CONSOLE format:**
```
192.168.1.1 - - [26/Mar/2026 14:30:45] "GET /index.html HTTP/1.1" 200 4096
```

**JSON format:**
```json
{"message":"request completed","method":"GET","path":"/api/data","status":200,"duration":"12ms"}
```

## Programmatic Usage

```go
loggingService, _ := logging.NewService(logging.TypeJSON)
defer loggingService.Sync()

proxyRoutes, _ := server.NewProxyRoutes([]string{"/api=http://backend:8081"})
policies, _ := server.NewRouteResponsePolicies([]string{"/=Cache-Control:no-store"})

config := server.FileServerConfiguration{
    BindAddress:   "127.0.0.1",
    Port:          "8000",
    DirectoryPath: "/var/www",
    EnableMarkdown: true,
    ProxyRoutes:   proxyRoutes,
    RouteResponsePolicies: policies,
}

formatter := serverdetails.NewServingAddressFormatter()
fileServer := server.NewFileServer(loggingService, formatter)
fileServer.Serve(ctx, config)
```

## Features

### File Serving
- `Server: ghttpd` header always set
- Serves `index.html`/`index.htm` as directory landing pages
- Markdown files (`.md`) rendered to HTML with GFM support
- `README.md` serves as directory landing page when markdown enabled

### Reverse Proxy
- Routes matched by longest prefix first
- Path rewriting: `/proxy-path/request` → `http://backend/request`
- WebSocket upgrades via connection hijacking
- Unbuffered mode for SSE/chunked responses

### TLS
- Self-signed HTTPS with dynamic CA/cert provisioning (`--https`)
- Existing cert/key support (`--tls-cert`, `--tls-key`)

### Graceful Shutdown
- Context-driven lifecycle: listens on `<-ctx.Done()`
- 3-second grace period for in-flight requests
