# LLM Proxy Integration Guide

## Overview

LLM Proxy is a lightweight HTTP service that forwards user prompts to OpenAI's Responses API and audio transcription API. It exposes protected HTTP endpoints requiring a shared secret, simplifying provider integration without embedding API credentials in clients.

**Module:** `github.com/temirov/llm-proxy`
**Go Version:** 1.24

## Dependencies

| Dependency | Purpose |
|---|---|
| `github.com/gin-gonic/gin` v1.10.1 | HTTP server framework |
| `github.com/spf13/cobra` v1.9.1 | CLI framework |
| `github.com/spf13/viper` v1.20.1 | Configuration management |
| `github.com/cenkalti/backoff/v4` v4.3.0 | Exponential backoff retries |
| `go.uber.org/zap` v1.27.0 | Structured logging |

## API Endpoints

### GET `/` — LLM Request

```
GET /?prompt=STRING&key=SERVICE_SECRET[&model=MODEL][&web_search=1][&format=CONTENT_TYPE][&system_prompt=TEXT]
```

| Parameter | Required | Default | Description |
|---|---|---|---|
| `prompt` | Yes | — | User prompt text |
| `key` | Yes | — | Shared service secret |
| `model` | No | `gpt-4.1` | OpenAI model name |
| `web_search` | No | `false` | `1`, `true`, or `yes` enables web search tool |
| `format` | No | `text/plain` | Response format (or use `Accept` header) |
| `system_prompt` | No | Config default | Override system prompt |

**Response formats:** `text/plain` (default), `application/json`, `application/xml`, `text/csv`

**Status codes:**
- `200` — success
- `400` — missing/invalid parameters
- `403` — invalid key
- `502` — OpenAI API error
- `504` — upstream timeout

### POST `/dictate` — Audio Transcription

```
POST /dictate?key=SERVICE_SECRET[&model=MODEL]
Content-Type: multipart/form-data
audio=<file>   (alias: file)
```

Response:
```json
{ "text": "transcribed text..." }
```

## Configuration

### Required Environment Variables

| Variable | Description |
|---|---|
| `SERVICE_SECRET` | Shared secret for `key` query parameter |
| `OPENAI_API_KEY` | OpenAI API key |

### Optional Environment Variables

| Variable | Flag | Default | Description |
|---|---|---|---|
| `HTTP_PORT` | `--port` | `8080` | Server port |
| `LOG_LEVEL` | `--log_level` | `info` | `debug` or `info` |
| `SYSTEM_PROMPT` | `--system_prompt` | (empty) | Default system prompt |
| `GPT_WORKERS` | `--workers` | `4` | Worker goroutines |
| `GPT_QUEUE_SIZE` | `--queue_size` | `100` | Request queue capacity |
| `GPT_REQUEST_TIMEOUT_SECONDS` | `--request_timeout` | `180` | Overall request timeout |
| `GPT_UPSTREAM_POLL_TIMEOUT_SECONDS` | `--upstream_poll_timeout` | `60` | Poll deadline for incomplete responses |
| `GPT_MAX_OUTPUT_TOKENS` | `--max_output_tokens` | `1024` | Max output tokens |
| `GPT_DICTATION_MODEL` | `--dictation_model` | `gpt-4o-mini-transcribe` | Default transcription model |
| `GPT_MAX_INPUT_AUDIO_BYTES` | `--max_input_audio_bytes` | `26214400` (25MB) | Max audio upload size |

## Model Capabilities

| Model | Web Search | Temperature | Tools | Reasoning |
|---|---|---|---|---|
| `gpt-4.1` | Yes | Yes | Yes | No |
| `gpt-4o` | Yes | Yes | Yes | No |
| `gpt-4o-mini` | No | Yes | No | No |
| `gpt-5` | Yes | No | Yes | Yes (medium) |
| `gpt-5-mini` | No | No | No | No |

## Exported Types

### Configuration

```go
type Configuration struct {
    ServiceSecret              string
    OpenAIKey                  string
    Port                       int
    LogLevel                   string
    SystemPrompt               string
    WorkerCount                int
    QueueSize                  int
    RequestTimeoutSeconds      int
    UpstreamPollTimeoutSeconds int
    MaxOutputTokens            int
    DictationModel             string
    MaxInputAudioBytes         int64
    Endpoints                  *Endpoints
}
```

### Endpoints (for testing/custom routing)

```go
endpoints := proxy.NewEndpoints()
endpoints.SetResponsesURL(url)      // Override OpenAI responses URL
endpoints.SetModelsURL(url)          // Override models URL
endpoints.SetTranscriptionsURL(url)  // Override transcriptions URL
endpoints.ResetResponsesURL()        // Restore defaults
```

### Key Functions

```go
func BuildRouter(configuration Configuration, logger *zap.SugaredLogger) (*gin.Engine, error)
func Serve(configuration Configuration, logger *zap.SugaredLogger) error
func BuildRequestPayload(model, prompt string, webSearch bool, maxTokens int) any
```

## Programmatic Integration

```go
endpoints := proxy.NewEndpoints()
logger, _ := zap.NewDevelopment()

router, err := proxy.BuildRouter(proxy.Configuration{
    ServiceSecret:         "my-secret",
    OpenAIKey:             os.Getenv("OPENAI_API_KEY"),
    LogLevel:              "info",
    WorkerCount:           4,
    QueueSize:             100,
    RequestTimeoutSeconds: 180,
    Endpoints:             endpoints,
}, logger.Sugar())

// Use as http.Handler or start serving
proxy.Serve(config, logger.Sugar())
```

## Middleware

### Authentication
- Validates `key` query parameter using constant-time HMAC-SHA256 comparison
- Returns `403 Forbidden` on mismatch

### Logging
- Logs method, path, client IP, status, latency
- Sanitizes URLs to redact `key` parameter value
- Supports `debug` and `info` levels

## OpenAI Integration Details

- Sends combined (system + user) prompt to OpenAI Responses API
- Implements response polling with configurable timeout
- Handles incomplete responses with synthesis continuation
- Automatic retries with stricter settings if initial attempt yields no text
- Web search tool adds synthesis instruction for final answer extraction

### Response Polling

Waits for terminal status: `completed`, `succeeded`, `done`, `cancelled`, `failed`, `errored`

For non-terminal incomplete responses:
1. `POST /{id}/continue` — attempt continuation
2. `POST /v1/responses` with `previous_response_id` — forced synthesis

## Error Types

```go
var ErrUpstreamIncomplete = errors.New("OpenAI API error (incomplete response)")
var ErrUnknownModel = errors.New("unknown model")
var ErrMissingServiceSecret = errors.New("SERVICE_SECRET must be set")
var ErrMissingOpenAIKey = errors.New("OPENAI_API_KEY must be set")
```

## Security

- Shared secret uses constant-time comparison (timing attack prevention)
- `key` parameter redacted from logs
- Service should not be exposed to public internet without network controls
- Configurable max audio upload size prevents DoS
