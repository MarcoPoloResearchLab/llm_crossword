# LLM Proxy Illustration API Contract

Status: proposed  
Last updated: 2026-03-30

## Purpose

This document defines the proposed `llm-proxy` API additions required by crossword illustration mode.

It is intentionally narrower than a full provider passthrough:

1. `llm-proxy` owns provider credentials and provider-specific transport
2. the crossword backend owns prompt composition, retry budgets, concurrency, and puzzle acceptance
3. the browser remains unaware of provider APIs

Current implemented proxy endpoints are documented in [integration.md](./integration.md). This document covers the new endpoints needed for:

1. text-to-image generation
2. multimodal verification with image input

## Scope

Phase 1 should add:

1. `POST /images/generations`
2. `POST /responses`

The existing `GET /` text endpoint should remain as the convenience path for simple text-only requests. The new `POST /responses` endpoint is the structured JSON path for multimodal verification and future non-trivial response requests.

## Shared Rules

### Authentication

All new endpoints should keep the existing shared-secret pattern:

1. `key=SERVICE_SECRET` query parameter
2. same constant-time comparison as current endpoints
3. `403` on missing or invalid secret

### Error shape

All new endpoints should return errors with a stable JSON body:

```json
{
  "error": "provider_timeout",
  "message": "upstream image generation timed out"
}
```

Optional debug fields may be added for internal use, but application logic should only depend on:

1. HTTP status
2. `error`
3. `message`

### Logging

The proxy should:

1. redact the shared secret
2. avoid logging raw base64 image payloads
3. avoid logging full prompt bodies at `info`
4. log provider request ids when available

## Phase 1 Defaults

For crossword illustration mode, phase 1 should standardize on:

1. image model: `gpt-image-1-mini`
2. image quality: `medium`
3. image size: `1024x1024`
4. response format: base64 image payload

These defaults should remain caller-configurable because cost and quality are product decisions, not proxy decisions.

## Endpoint: `POST /images/generations`

### Purpose

Generate one illustration from a text prompt.

### Request

```http
POST /images/generations?key=SERVICE_SECRET
Content-Type: application/json
```

```json
{
  "model": "gpt-image-1-mini",
  "prompt": "Clean storybook illustration of Apollo as the Greek god, holding a lyre, centered subject, no text, no rockets, plain background.",
  "size": "1024x1024",
  "quality": "medium",
  "response_format": "b64_json"
}
```

### Request fields

| Field | Required | Notes |
| --- | --- | --- |
| `model` | yes | Phase 1 caller should send `gpt-image-1-mini` explicitly. |
| `prompt` | yes | Final caller-composed generation prompt. |
| `size` | no | Default `1024x1024`. |
| `quality` | no | Default `medium`. |
| `response_format` | no | Phase 1 should use `b64_json`. |
| `background` | no | Optional future-safe passthrough if provider supports it. |
| `user` | no | Optional trace field if provider supports it. |

### Success response

```json
{
  "provider": "openai",
  "provider_request_id": "imgreq_123",
  "model": "gpt-image-1-mini",
  "size": "1024x1024",
  "quality": "medium",
  "mime_type": "image/png",
  "image_b64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "revised_prompt": "",
  "moderation": {
    "provider_status": "passed"
  }
}
```

### Response requirements

The response should:

1. return exactly one generated image for phase 1
2. include MIME type
3. include provider request id when available
4. surface provider moderation outcome when available
5. avoid embedding provider-specific raw response bodies unless explicitly requested for debugging

### Error mapping

| HTTP | `error` | Meaning |
| --- | --- | --- |
| `400` | `invalid_payload` | malformed JSON or missing required field |
| `400` | `invalid_model` | unsupported or unknown image model |
| `400` | `invalid_size` | unsupported size |
| `400` | `invalid_quality` | unsupported quality |
| `403` | `unauthorized` | missing or invalid shared secret |
| `422` | `content_filtered` | provider rejected the request for safety or policy reasons |
| `429` | `provider_rate_limited` | upstream rate limit |
| `502` | `provider_error` | upstream non-timeout provider failure |
| `504` | `provider_timeout` | upstream timeout |

## Endpoint: `POST /responses`

### Purpose

Accept structured JSON requests for Responses API use cases that do not fit the existing `GET /` endpoint, especially multimodal verification with image input.

Phase 1 crossword usage is verification, not general chat.

### Request

```http
POST /responses?key=SERVICE_SECRET
Content-Type: application/json
```

```json
{
  "model": "gpt-4.1-mini",
  "input": [
    {
      "role": "system",
      "content": [
        {
          "type": "input_text",
          "text": "You verify generated crossword illustrations. Return only JSON."
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "input_text",
          "text": "Expected subject: Apollo the Greek god. Reject rockets, spacecraft, mission patches, and visible text."
        },
        {
          "type": "input_image",
          "image_b64": "iVBORw0KGgoAAAANSUhEUgAA...",
          "mime_type": "image/png"
        }
      ]
    }
  ],
  "text": {
    "format": {
      "type": "json_schema",
      "name": "illustration_verification",
      "schema": {
        "type": "object"
      }
    }
  }
}
```

### Request contract

The proxy should accept a validated subset of the provider's Responses JSON contract, not an unbounded passthrough.

Phase 1 required fields:

1. `model`
2. `input`
3. optional structured text-format request for JSON output

Phase 1 explicitly does not require the crossword backend to use:

1. tool calling
2. background mode
3. arbitrary file uploads

### Success response

```json
{
  "id": "resp_123",
  "model": "gpt-4.1-mini",
  "status": "completed",
  "output_text": "{\"passed\":true,\"confidence\":0.94,\"issues\":[],\"retry_guidance\":\"\"}"
}
```

The proxy may keep richer raw provider details internally, but the crossword backend needs only:

1. provider response id
2. final status
3. extracted output text

### Error mapping

| HTTP | `error` | Meaning |
| --- | --- | --- |
| `400` | `invalid_payload` | malformed JSON or unsupported field shape |
| `400` | `invalid_model` | unsupported or unknown response model |
| `403` | `unauthorized` | missing or invalid shared secret |
| `413` | `input_too_large` | image payload exceeds configured limit |
| `429` | `provider_rate_limited` | upstream rate limit |
| `502` | `provider_error` | upstream non-timeout provider failure |
| `504` | `provider_timeout` | upstream timeout |

## Non-Goals

This proxy extension should not:

1. decide whether an illustration is acceptable for crossword use
2. choose crossword retry strategy
3. store accepted assets
4. persist puzzle metadata
5. absorb crossword-specific business rules

## Crossword Backend Responsibilities

The crossword service should continue to own:

1. illustration prompt composition
2. verifier prompt composition
3. capped parallelism
4. retry budgets
5. word-level and puzzle-level acceptance
6. persistence of accepted asset metadata

## Suggested Implementation Order

1. add `POST /images/generations`
2. add structured proxy error mapping
3. add `POST /responses` JSON path with multimodal input support
4. add payload-size controls for image-bearing requests
5. add tests covering generation, verification, and error translation
