# Utils Integration Guide

## Overview

A modular Go utility collection organized by package. Each package is independently importable for minimal dependency footprint.

**Module:** `github.com/tyemirov/utils`
**Go Version:** 1.26
**License:** MIT

## Core Dependencies

| Dependency | Purpose |
|---|---|
| `github.com/PuerkitoBio/goquery` v1.12.0 | CSS selector DOM traversal |
| `github.com/chromedp/chromedp` v0.15.1 | Headless Chrome automation |
| `github.com/gocolly/colly` v2.3.0 | Web scraping with retry/backoff |
| `github.com/spf13/viper` v1.19.0 | Configuration loading |
| `github.com/stretchr/testify` v1.9.0 | Testing assertions |

---

## Package: `llm` — OpenAI Chat Client

Minimal HTTP adapter for OpenAI-compatible `/chat/completions` endpoints with optional retry/backoff.

### Types

```go
type Config struct {
    BaseURL             string        // Default: "https://api.openai.com/v1"
    APIKey              string        // REQUIRED
    Model               string        // REQUIRED (e.g., "gpt-4.1-mini")
    MaxCompletionTokens int           // Default: 512
    Temperature         float64
    HTTPClient          HTTPClient
    RequestTimeout      time.Duration // Default: 60s
    RetryAttempts       int           // Default: 3
    RetryInitialBackoff time.Duration // Default: 200ms
    RetryMaxBackoff     time.Duration // Default: 2s
    RetryBackoffFactor  float64       // Default: 2.0
}

type ChatRequest struct {
    Model          string           // Override config model
    Messages       []Message        // REQUIRED (at least one)
    MaxTokens      int
    Temperature    *float64
    ResponseFormat *ResponseFormat  // For JSON schema responses
}

type Message struct {
    Role    string // "system", "user", "assistant"
    Content string
}

type ResponseFormat struct {
    Type   string          // "json_schema" for structured output
    Name   string
    Schema json.RawMessage
    Strict bool
}
```

### Interfaces

- `ChatClient` — `Chat(ctx context.Context, request ChatRequest) (string, error)`
- `HTTPClient` — `Do(request *http.Request) (*http.Response, error)`

### Usage

```go
// Simple client (no retries)
client, err := llm.NewClient(llm.Config{
    APIKey: os.Getenv("OPENAI_API_KEY"),
    Model:  "gpt-4.1-mini",
})
response, err := client.Chat(ctx, llm.ChatRequest{
    Messages: []llm.Message{{Role: "user", Content: "Hello"}},
})

// Factory with retry/backoff
factory, err := llm.NewFactory(config,
    llm.WithRetryPolicy(llm.RetryPolicy{
        MaxAttempts:       5,
        InitialBackoff:    500 * time.Millisecond,
        MaxBackoff:        10 * time.Second,
        BackoffMultiplier: 2.0,
    }),
)
response, err := factory.Chat(ctx, request)
```

**Errors:** `ErrEmptyResponse` — LLM returned empty/whitespace payload.

---

## Package: `file` — Filesystem Helpers

```go
func RemoveAll(dir string)                           // Recursive delete; errors logged
func RemoveFile(path string)                          // Delete file; errors logged
func CloseFile(closer io.Closer)                      // Safely close; logs errors
func ReadLines(filename string) ([]string, error)     // File → slice of lines
func SaveFile(outputDir, fileName string, data []byte) error  // Write .html file
func ReadFile(path string) (*bytes.Reader, error)     // Load into bytes.Reader
```

---

## Package: `math` — Numeric Helpers

```go
func Min(a, b int) int
func Max(a, b int) int
func FormatNumber(num *float64) string  // 12.3400 → "12.34"
func ChanceOf(probability float64) bool // true with given probability (crypto/rand)
```

---

## Package: `text` — String Normalization

```go
func Normalize(input string) string          // Trim lines, remove empty lines
func SanitizeToCamelCase(input string) string // "Example Title" → "exampleTitle"
```

---

## Package: `system` — Environment Variables

```go
func GetEnvOrFail(name string) string         // Retrieve env var or log.Fatalf
func ExpandEnvVar(envVar string) (string, error) // Expand $VAR references, trim
```

---

## Package: `pointers` — Primitive Pointer Helpers

```go
func FromFloat(value float64) *float64
func FromString(value string) *string
func FromInt(value int) *int
func FromBool(value bool) *bool
```

---

## Package: `scheduler` — Retry-Aware Job Scheduler

### Types

```go
type Job struct {
    ID              string
    ScheduledFor    *time.Time
    RetryCount      int
    LastAttemptedAt time.Time
    Payload         any
}

type Config struct {
    Repository    Repository     // REQUIRED
    Dispatcher    Dispatcher     // REQUIRED
    Logger        *slog.Logger   // REQUIRED
    Interval      time.Duration  // Scan interval
    MaxRetries    int
    SuccessStatus string
    FailureStatus string
    Clock         Clock          // Optional; defaults to time.Now()
}
```

### Interfaces

- `Repository` — `PendingJobs(ctx, maxRetries, now) ([]Job, error)` + `ApplyAttemptResult(ctx, job, update) error`
- `ClaimingRepository` (optional) — `ClaimJobForAttempt(ctx, job, now) (bool, error)` for distributed locking
- `Dispatcher` — `Attempt(ctx, job) (DispatchResult, error)` for effectful work

### Usage

```go
worker, err := scheduler.NewWorker(scheduler.Config{
    Repository:    customRepository,
    Dispatcher:    customDispatcher,
    Logger:        slog.Default(),
    Interval:      30 * time.Second,
    MaxRetries:    5,
    SuccessStatus: "sent",
    FailureStatus: "failed",
})

go worker.Run(ctx)        // Run continuously
worker.RunOnce(ctx)       // Single cycle
```

Backoff: exponential `interval * 2^retryCount` (capped at 2^20).

---

## Package: `crawler` — Production Web Scraper

### Configuration

```go
type Config struct {
    PlatformID      string           // REQUIRED (e.g., "AMZN")
    Scraper         ScraperConfig    // Concurrency, retries, network
    Platform        PlatformConfig   // Domain allowlist, cookies
    OutputDirectory string           // Optional; auto-creates FilePersister
    RunFolder       string           // Scopes artifacts per execution
    RuleEvaluator   RuleEvaluator    // REQUIRED
    // ... optional hooks, headers, logger
}

type ScraperConfig struct {
    MaxDepth, Parallelism, RetryCount int
    HTTPTimeout, RateLimit            time.Duration
    ProxyList                         []string
    SaveFiles                         bool
    ProxyCircuitBreakerEnabled        bool
}
```

### Key Interfaces

- `RuleEvaluator` — `Evaluate(productID, doc) (RuleEvaluation, error)` + `ConfiguredVerifierCount() int`
- `FilePersister` — `Save(productID, fileName, content) error` + `Close() error`
- `ResponseHandler` — Extends pipeline: `HandleBinaryResponse()`, `BeforeEvaluation()`, `AfterEvaluation()`

### Usage

```go
results := make(chan *crawler.Result, 100)
service, err := crawler.NewService(cfg, results,
    crawler.WithResponseHandlers(handler),
)
products := []crawler.Product{
    {ID: "p1", Platform: "AMZN", URL: "https://example.com"},
}
err = service.Run(ctx, products)

for result := range results {
    fmt.Println(result.ProductID, result.Success)
}
```

**Features:** Proxy rotation with circuit breaker, exponential backoff retries, rate limiting, concurrent file persistence, custom headers and cookie injection.

---

## Package: `jseval` — Headless Browser Rendering

### Types

```go
type Config struct {
    Timeout          time.Duration // Default: 30s
    WaitSelector     string        // CSS selector to wait for
    ProxyURL         string        // HTTP/SOCKS proxy
    UserAgent        string
    IgnoreCertErrors bool
}

type Result struct {
    HTML     string  // Rendered outer HTML
    Title    string  // Document title after JS
    FinalURL string  // After redirects
}
```

### Functions

```go
func RenderPage(ctx, targetURL, config) (*Result, error)    // Single page
func RenderPages(ctx, urls, config) ([]*Result, []error)    // Concurrent batch
```

### Usage

```go
result, err := jseval.RenderPage(ctx, "https://example.com", jseval.Config{
    Timeout:      10 * time.Second,
    WaitSelector: ".content",
    ProxyURL:     "http://user:pass@proxy:8080",
})
fmt.Println(result.HTML)
```

**Features:** Stealth mode flags, SOCKS5 auth via local forwarder, HTTP proxy auth via Fetch API.

---

## Package: `preflight` — Configuration Reporting

```go
func HashSHA256Hex(data []byte) string  // Hex-encoded SHA256 digest
```

---

## Integration Patterns

- **Dependency injection**: All packages support constructor-based injection via interfaces
- **Context propagation**: All I/O operations accept `context.Context`
- **Error handling**: Packages return explicit errors; file package logs but returns success
- **Testing**: Inject mocks via `HTTPClient`, `SleepFunc`, `Repository`, `Dispatcher`, `Clock` interfaces

## Environment Variables

| Variable | Package | Required |
|---|---|---|
| `OPENAI_API_KEY` | llm (via Config.APIKey) | Yes |
| `OPENAI_BASE_URL` | llm (via Config.BaseURL) | No |
| Any `$VAR` in path | system (`ExpandEnvVar`) | Depends on usage |

## Build & Test

```bash
make test              # All tests
make test-unit         # Unit tests only
make test-integration  # Integration tests only
make test-coverage     # Coverage report (100% threshold)
make lint              # vet + staticcheck + ineffassign
make ci                # Full CI pipeline
```
