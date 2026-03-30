# Word Illustration Feature Plan

Status: draft  
Last updated: 2026-03-30

## Summary

This document defines the plan for a crossword feature where every generated word can display an illustration. The current preferred direction is to generate those illustrations with an image model instead of pulling them directly from Wikipedia or Wikimedia Commons.

The core product decision is:

1. generated images are the primary illustration source
2. illustration generation happens on the backend, not in the browser
3. every word carries explicit subject context so the generated image stays on-topic
4. every generated image must pass a verification loop before acceptance
5. a puzzle in illustration mode is valid only when every word has an accepted image

This direction fits the product better because it gives us a unified visual style, better control over composition, and less dependence on inconsistent third-party editorial images.

## Problem Statement

The current system generates words, clues, and hints, but it does not define how those words become illustrations. A direct encyclopedia-image approach has two problems for this product:

1. visual style varies wildly from word to word
2. ambiguous words can still resolve to the wrong subject

Examples from the current data:

1. `Apollo` could mean the Greek god or the Apollo program
2. `Mare` is ambiguous without lunar context
3. `Music`, `teacher`, or `school` are broad subjects with no single canonical look

Generated illustrations solve a different set of problems:

1. we can control the style
2. we can center the subject
3. we can avoid random logos, badges, and page maintenance images
4. we can keep the whole puzzle visually coherent

But generated images create their own risks:

1. the model can depict the wrong thing
2. the model can add text or labels that leak the answer
3. per-word generation increases latency and cost
4. quality control becomes a required system responsibility
5. verification must produce actionable retry feedback, not just pass or fail

Because of this, illustration mode must change both the generation pipeline and the rendering pipeline.

## Goals

1. Every generated word in illustration mode has one accepted illustration.
2. The puzzle has a clear, uniform art direction.
3. The same puzzle renders the same illustrations on reload, on another device, and through share links.
4. The generated art reflects the intended meaning of the word, not just the surface spelling.
5. The system can inject subject-specific context for ambiguous words.
6. The frontend stays presentation-focused and does not run generation logic.
7. The design works for both generated puzzles and prebuilt puzzles.

## Non-Goals

1. Replacing clue text with pictures only.
2. Training a custom model in phase 1.
3. Supporting arbitrary user-defined visual styles in phase 1.
4. Running on-device image generation in the browser.
5. Building a full human moderation dashboard in phase 1.

## Recommended Product Decisions

These decisions should be treated as defaults unless product requirements change.

### 1. Generated images are the primary asset source

Illustration mode should not rely on encyclopedia-hosted images as the main rendered asset. Instead:

1. the system generates an illustration for each word
2. the system persists the chosen result
3. the frontend only renders stored asset metadata

Reference knowledge can still inform prompts, but the final displayed asset should be generated art.

### 2. Each word needs explicit subject context

The model should not receive only the bare answer word. Each word item should carry enough context to disambiguate the intended subject.

Examples:

1. `APOLLO` plus context `Greek god associated with lyre, sunlight, and prophecy`
2. `APOLLO` plus context `NASA moon-landing program with rockets and mission patch`
3. `MARE` plus context `dark basalt plain on the Moon`

This is the most important control for subject accuracy.

### 3. Style must be centralized

Illustration uniformity should not be left to ad hoc prompts. The system should define one house style profile and apply it to every word.

That style profile should control:

1. medium
2. color treatment
3. background simplicity
4. camera framing
5. subject isolation
6. complexity level
7. text avoidance

### 4. Illustration mode must be image-complete

If any word fails image generation or quality review, the puzzle should not quietly degrade into a partial result. Instead it should:

1. retry generation for the failed word
2. regenerate only failed words if needed
3. fail illustration mode if the puzzle cannot become complete within budget

### 5. Verification must be explicit

The system should not assume that a returned image is acceptable just because the provider call succeeded. Every image should go through a verification step that:

1. compares the image to the intended subject context
2. detects obvious failures such as text, wrong subject, or clutter
3. produces machine-readable failure reasons
4. feeds those reasons into prompt revision and retry

The important point is that verification should generate useful feedback, not just a binary rejection.

### 6. Images should appear as an optional clue aid first

The first UI version should add a single illustration card tied to the active clue or active word. That preserves puzzle readability and avoids flooding the clue list with thumbnails.

Recommended first behavior:

1. user selects a clue or grid entry
2. clue panel shows the illustration card for that word
3. card can expand to a larger modal or lightbox
4. metadata such as style label or source type is available in the expanded view

### 7. Normalize the frame, not the source image

Generated images should still be displayed in a fixed-size frame, using:

1. consistent card dimensions
2. `object-fit: contain`
3. intrinsic aspect-ratio preservation
4. centered subject positioning

## Current State

The current generation pipeline is:

1. backend asks the LLM for `word`, `definition`, and `hint`
2. backend stores those values in the database
3. frontend passes the items into the crossword generator
4. widget renders clue text and the existing hint UI

Current implementation points:

1. `backend/internal/crosswordapi/llm.go` returns only `word`, `definition`, and `hint`
2. `backend/internal/crosswordapi/store.go` persists only those fields per word
3. `js/generator.js` passes clue and hint into entry payloads
4. `js/crossword-widget.js` renders clue text and hint controls

The feature should extend this existing pipeline instead of introducing a separate browser-side generation workflow.

## Architecture Overview

The proposed architecture is backend-generated, persistence-first, and vendor-agnostic.

### End-to-end flow

1. User requests a generated puzzle in illustration mode.
2. Backend requests words from the LLM using an illustration-aware prompt.
3. Backend receives words plus structured visual context for each word.
4. Backend composes a final image prompt from the global style profile and the word context.
5. Backend calls an image generation provider.
6. Backend runs a verification step on the returned asset.
7. Backend records the verifier result and failure reasons.
8. Backend revises the prompt and retries failed words within a fixed budget.
9. Backend persists accepted illustration metadata with the puzzle.
10. Backend returns puzzle items and illustration metadata in the API response.
11. Frontend renders the puzzle and uses the persisted illustration fields only.

### LLM proxy boundary

Phase 1 should keep provider credentials and provider-specific request formats behind `llm-proxy`, not inside the crossword service.

The current proxy only covers:

1. `GET /` for text generation through the OpenAI Responses API
2. `POST /dictate` for transcription

Illustration mode requires explicit proxy additions.

Required `llm-proxy` changes:

1. add `POST /images/generations` for text-to-image generation
2. add a JSON-based responses endpoint that can pass multimodal inputs for vision-based verification
3. accept model, size, quality, and output-format parameters without exposing the OpenAI key to the crossword service
4. return structured error classes that let the crossword backend distinguish provider failure from moderation or validation failure
5. preserve the existing shared-secret authentication model

Recommended phase 1 request shape for image generation:

1. model: `gpt-image-1-mini`
2. quality: `medium`
3. size: `1024x1024`
4. response format: base64 image payload plus provider metadata

The crossword backend should remain responsible for:

1. prompt composition
2. concurrency limits
3. retry budget
4. persistence
5. puzzle-level acceptance rules

The proxy should remain a narrow transport boundary over provider APIs rather than absorbing crossword-specific business logic.

### Why backend generation is the right boundary

1. The backend already owns generation and persistence.
2. The backend can parallelize, retry, and rate-limit image generation.
3. The backend can keep provider details out of the browser.
4. The backend can run quality checks before a puzzle is accepted.
5. Shared links remain deterministic because assets are chosen once and stored.

## Image Strategy

### Primary asset source

The displayed image should come from an image generator, not a third-party page image.

### Reference knowledge

Reference context can still be useful, but it should be used as prompt input rather than as the rendered asset. The system may keep optional fields such as:

1. reference title
2. entity label
3. short subject context
4. distinguishing visual traits

These fields exist to keep prompts accurate, especially for ambiguous answers.

### Provider abstraction

The backend should treat the image generator as a pluggable provider. Phase 1 should use an API-based provider, not self-hosted GPU infrastructure.

In this repository family, that means two layers:

1. a crossword-side provider interface used by the puzzle generation pipeline
2. an `llm-proxy` transport adapter that speaks to the external model API

The crossword service should depend on the crossword-side interface, not on raw OpenAI HTTP requests.

The abstraction should hide:

1. model name
2. prompt format
3. image size options
4. retry behavior
5. moderation response format
6. proxy request and response details

### Phase 1 provider decision

Phase 1 should standardize on:

1. text generation through the existing `llm-proxy` text path
2. image generation through a new `llm-proxy` image-generation path
3. `gpt-image-1-mini` at `medium` quality as the default illustration model
4. `1024x1024` generation with optional downscaling at render or storage time

This default keeps image cost low enough for consumer pricing while still targeting better prompt fidelity than the cheapest image tier.

### Why an API provider first

1. current repo infrastructure does not include GPU serving
2. provider APIs are faster to validate as a product decision
3. self-hosting can be evaluated later if cost or throughput requires it

## Prompt Strategy

Prompt quality is the main determinant of illustration quality.

### Global style profile

The system should define a single style profile object, for example:

1. medium: clean storybook illustration
2. palette: bright but controlled
3. background: simple and uncluttered
4. framing: single centered subject
5. detail level: enough to recognize, not photorealistic
6. text policy: no letters, no logos, no labels

This style profile should be versioned so future revisions do not silently change old puzzles.

### Word-specific context

Each word should include a short, structured context block. Recommended fields:

1. `visual_subject`
2. `subject_context`
3. `must_include`
4. `must_avoid`
5. `alt_text_seed`

Example:

```json
{
  "word": "APOLLO",
  "definition": "Greek god of music, prophecy, and healing",
  "hint": "Olympian often shown with a lyre",
  "visual_subject": "Apollo, the Greek god",
  "subject_context": "Ancient mythological male figure associated with a lyre and laurel",
  "must_include": ["single figure", "lyre", "classical robe"],
  "must_avoid": ["rockets", "spacecraft", "text", "mission patches"],
  "alt_text_seed": "Illustration of Apollo with a lyre"
}
```

### Final prompt composition

The backend should combine:

1. the global style profile
2. the word-specific context
3. hard safety and quality constraints

Example composition:

1. style instructions
2. subject instructions
3. inclusion constraints
4. exclusion constraints
5. output constraints such as no text and simple background

### Negative constraints

Every prompt should include stable exclusion rules such as:

1. no text
2. no letters
3. no labels
4. no watermarks
5. no multiple unrelated subjects
6. no UI elements

## Verification and Quality Gate

Generated art must be reviewed automatically before it is accepted.

### Verification loop

Verification should be modeled as a loop, not a single check.

Recommended loop per word:

1. compose prompt from style profile and subject context
2. generate image
3. verify the image against the expected subject
4. if verification fails, capture failure reasons
5. revise the prompt using those failure reasons
6. retry within the per-word attempt budget
7. accept only when verification passes

### Verifier inputs

The verifier should receive:

1. answer word
2. clue and hint
3. `visual_subject`
4. `subject_context`
5. `must_include`
6. `must_avoid`
7. style profile identifier
8. generated image

### Verifier outputs

The verifier should return structured output, not plain prose.

Suggested fields:

1. `passed`
2. `confidence`
3. `observed_subject`
4. `matches_intended_subject`
5. `contains_text`
6. `contains_multiple_unrelated_subjects`
7. `contains_forbidden_elements`
8. `missing_required_elements`
9. `safety_passed`
10. `issues`
11. `retry_guidance`

### Required verification checks

An illustration should pass only if:

1. the subject matches the intended meaning of the word
2. required elements are present when they matter
3. forbidden elements are absent
4. the image does not contain visible text
5. the image contains one clear main subject
6. the image is safe for the product audience
7. the image composition is usable inside the clue-card frame

### Recommended verification methods

Phase 1 should combine more than one signal when practical:

1. provider moderation response
2. heuristic checks such as aspect ratio and blank-image detection
3. a vision-model review prompt that compares the image to the intended context

The vision-model verifier is the key part of the loop because it can explain why the image is wrong in a way that can drive the next retry.

In transport terms, that means the verifier should not require direct provider calls from the crossword backend. The verifier path should also run through `llm-proxy` so the crossword service can send structured multimodal verification requests without owning provider credentials.

### Failure taxonomy

The system should classify failures so retries can be targeted.

Suggested issue types:

1. `wrong_subject`
2. `subject_too_generic`
3. `missing_required_element`
4. `forbidden_element_present`
5. `visible_text`
6. `multiple_subjects`
7. `bad_composition`
8. `unsafe_content`
9. `provider_error`

### Retry guidance generation

Each failed verification should produce retry guidance that can refine the next prompt.

Examples:

1. if the image contains rockets for `Apollo` the Greek god, add stronger avoid rules for spacecraft and reinforce mythological attire
2. if the image contains visible text, strengthen the no-text rule and simplify the composition
3. if the main subject is too small, require a centered close subject with a plain background

### Retry strategy

If a generated image fails:

1. revise the prompt using verifier output
2. retry the provider call within the word budget
3. if repeated failures show the word itself is too ambiguous, regenerate the word with stronger context requirements
4. if still failing, mark the word as failed

At puzzle scope:

1. retry only failed words first
2. if repeated failures cluster around poor word choices, regenerate the failed words themselves

### Suggested status enum

Use a single status field to make behavior explicit:

1. `generated`
2. `accepted`
3. `failed_prompt`
4. `failed_quality`
5. `failed_moderation`
6. `failed_provider`
7. `failed_budget`
8. `failed_verification`

## Data Model

### Backend generation shape

Current `WordItem` contains only three fields. Illustration mode should extend it with visual context and a generated-asset payload.

Suggested shape:

```json
{
  "word": "APOLLO",
  "definition": "Greek god of music, prophecy, and healing",
  "hint": "Olympian often shown with a lyre",
  "visual_subject": "Apollo, the Greek god",
  "subject_context": "Ancient mythological male figure associated with a lyre and laurel",
  "must_include": ["single figure", "lyre", "classical robe"],
  "must_avoid": ["rockets", "spacecraft", "text", "mission patches"],
  "alt_text_seed": "Illustration of Apollo with a lyre",
  "illustration_status": "accepted",
  "illustration": {
    "source_type": "generated",
    "provider": "image-api",
    "model": "provider-model-name",
    "style_profile": "storybook-v1",
    "prompt_version": "illustration-v1",
    "prompt_text": "final provider prompt",
    "revised_prompt_text": "",
    "asset_url": "https://cdn.example.com/puzzles/.../apollo.png",
    "width": 1024,
    "height": 1024,
    "seed": "optional-provider-seed",
    "moderation_status": "passed",
    "verification_status": "passed",
    "verification_confidence": 0.94,
    "verification_issues": [],
    "verification_retry_guidance": "",
    "content_hash": "sha256:...",
    "alt_text": "Illustration of Apollo with a lyre"
  }
}
```

### Database persistence

Persist illustration metadata on `PuzzleWord`, not only in transient API responses.

Suggested new columns:

1. `VisualSubject`
2. `SubjectContext`
3. `MustIncludeJSON`
4. `MustAvoidJSON`
5. `AltTextSeed`
6. `IllustrationStatus`
7. `IllustrationSourceType`
8. `IllustrationProvider`
9. `IllustrationModel`
10. `IllustrationStyleProfile`
11. `IllustrationPromptVersion`
12. `IllustrationPromptText`
13. `IllustrationRevisedPromptText`
14. `IllustrationAssetURL`
15. `IllustrationWidth`
16. `IllustrationHeight`
17. `IllustrationSeed`
18. `IllustrationModerationStatus`
19. `IllustrationVerificationStatus`
20. `IllustrationVerificationConfidence`
21. `IllustrationVerificationIssuesJSON`
22. `IllustrationVerificationRetryGuidance`
23. `IllustrationContentHash`
24. `IllustrationAltText`

If column count becomes unwieldy, list-like prompt fields can move into a JSON blob later.

### Frontend payload propagation

`js/generator.js` should preserve the illustration fields on each entry so the widget receives a complete rendering payload. The crossword layout algorithm should remain unaware of image generation logic.

## API Contract Changes

### Generate endpoint

The `POST /api/generate` response should return enriched items with generated-image metadata.

Suggested response shape:

```json
{
  "id": "puzzle-id",
  "share_token": "abc123def4",
  "title": "Crossword — Greek Gods",
  "subtitle": "Generated from \"Greek gods\" topic.",
  "items": [
    {
      "word": "APOLLO",
      "definition": "Greek god of music, prophecy, and healing",
      "hint": "Olympian often shown with a lyre",
      "visual_subject": "Apollo, the Greek god",
      "subject_context": "Ancient mythological male figure associated with a lyre and laurel",
      "illustration_status": "accepted",
      "illustration": {
        "source_type": "generated",
        "provider": "image-api",
        "style_profile": "storybook-v1",
        "asset_url": "https://cdn.example.com/puzzles/.../apollo.png",
        "width": 1024,
        "height": 1024,
        "verification_status": "passed",
        "alt_text": "Illustration of Apollo with a lyre"
      }
    }
  ],
  "balance": 42
}
```

### Stored puzzle endpoints

Any endpoint returning a stored puzzle should return the same illustration fields. The frontend should not need a second generation request when loading an existing puzzle.

## Frontend UX Plan

### Default placement

The first implementation should add an illustration panel tied to the active clue or active word.

Recommended behavior:

1. no clue selected: panel shows a neutral empty state
2. clue selected with accepted illustration: panel shows the generated image and alt text
3. clue selected while asset loads: panel shows a skeleton placeholder
4. clue selected with failed illustration: panel shows a compact unavailable state

### Suggested layout behavior

1. desktop: illustration card sits above or below the clue groups in the right-hand column
2. mobile: illustration card appears above the clue lists or in a collapsible drawer
3. expanded view: clicking the image opens a modal with a larger version

### Accessibility

1. every image must have meaningful alt text
2. the expanded modal must be keyboard accessible
3. empty and unavailable states must be announced in readable text

### Suggested alt text strategy

Build alt text from stored context fields, not from raw answer text alone.

Suggested order:

1. generated alt text from `alt_text_seed`
2. normalized text based on `visual_subject`
3. final fallback `Illustration for {word}`

### Sizing rules

Recommended frame defaults:

1. clue panel card width follows container width
2. fixed visual height such as 180 to 240 pixels on desktop
3. `object-fit: contain`
4. centered subject
5. quiet background so style remains consistent

## Content Quality Rules

### Acceptable subjects

Good illustration candidates:

1. `Tiger`
2. `Saturn`
3. `Athena`
4. `Triceratops`
5. `London`
6. `Volcano`

### Weak subjects

Poor illustration candidates:

1. `Music`
2. `School`
3. `Animal`
4. `Teacher`
5. `February`
6. `Google` when the intended depiction is unclear

### Prompt changes required

Illustration mode should change the LLM prompt to require:

1. concrete, visually depictable answers
2. a short subject context for each word
3. explicit include and avoid constraints when useful
4. no ambiguous generic words unless the context can clearly disambiguate them

This is the most important content-quality control in the system.

## Performance and Storage

Generated illustrations are heavier than text generation, so the plan must account for latency.

### Generation behavior

Recommended phase 1 behavior:

1. generate images on the backend with capped concurrency
2. verify every returned image before acceptance
3. store the accepted image asset in project-controlled storage
4. return persisted URLs to the frontend

### Why project-controlled storage matters

1. assets remain stable after generation
2. shared puzzles do not depend on third-party asset availability
3. the frontend receives one deterministic URL per word
4. future CDN or cache changes stay internal

### Synchronous vs asynchronous generation

This is an important implementation choice.

Recommended default:

1. start with synchronous generation only if the provider is fast enough at the chosen word counts
2. if end-to-end latency becomes too high, move illustrated puzzle creation to a background job with progress UI

The current doc does not require that decision to be made immediately, but it should be measured early.

## Provider and Safety Considerations

### Provider abstraction requirements

The provider layer should support:

1. generate image
2. optional prompt revision metadata
3. moderation result capture
4. stable model identification
5. provider-specific retry classification

For the `llm-proxy` transport layer, phase 1 should additionally support:

1. image-generation requests with explicit `model`, `size`, and `quality`
2. image responses that include binary payload or base64 payload plus content type
3. multimodal verification requests that can include image input plus structured expected context
4. provider error mapping into stable application-facing error codes
5. request and response logging that redact secrets and avoid logging raw image bytes by default

### Verifier abstraction requirements

The verifier layer should support:

1. inspect generated image against expected context
2. return structured issues
3. suggest retry guidance
4. expose confidence
5. remain swappable from one verification method to another

### Safety requirements

Illustration mode must reject or retry content that is:

1. unsafe for the audience
2. off-topic
3. text-heavy
4. visually confusing

## Validation Rules

### Puzzle-level acceptance

An illustration-enabled puzzle is valid only if:

1. every word is unique and already passes normal crossword validation
2. every word has `illustration_status = accepted`
3. every word has a non-empty stored asset URL
4. every word has usable alt text
5. every word has `verification_status = passed`

### Word-level rejection triggers

Reject a generated image if:

1. the subject does not match the intended meaning
2. visible text or labels appear
3. composition is too cluttered for the clue-card frame
4. moderation fails
5. provider generation fails repeatedly
6. verification confidence stays too low after retries

## Prebuilt Puzzle Migration

Prebuilt puzzle data in `assets/data/crosswords.json` should not generate images in the browser.

Recommended migration approach:

1. create an offline batch generation workflow
2. generate illustrations for every prebuilt item
3. manually review ambiguous themes
4. replace weak words where necessary
5. save accepted generated-asset metadata into the puzzle source or a companion dataset

Important note:

Several current prebuilt themes will likely need editorial cleanup before they can support the new feature cleanly.

## Testing Strategy

### Backend unit tests

Add table-driven tests for:

1. prompt composition from style plus subject context
2. include and avoid constraint handling
3. verifier output parsing
4. prompt revision from verifier feedback
5. status transitions on retry
6. puzzle-level completeness enforcement
7. asset metadata persistence

### Backend integration tests

Use stubbed provider responses for:

1. successful generation flow
2. failed generation with retry
3. failed moderation
4. failed verification with prompt revision
5. quality-gate rejection
6. puzzle failure after attempt budget

Do not rely on live provider calls in CI.

### Frontend tests

Add UI coverage for:

1. illustration card renders for active clue
2. empty state before clue selection
3. unavailable state when metadata says generation failed
4. expanded modal renders the stored generated image
5. mobile layout does not collapse clue usability

## Rollout Plan

### Phase 0. Documentation

1. approve this design direction
2. lock the product defaults around style and completeness
3. confirm provider and latency assumptions

### Phase 1. Backend schema and provider layer

1. extend `WordItem`
2. extend `PuzzleWord`
3. add generated-image provider abstraction
4. extend `llm-proxy` with image-generation and multimodal verification endpoints
5. add verifier abstraction
6. add prompt builder and tests

### Phase 2. Illustration-aware text generation

1. update the LLM prompt to require visual context
2. add include and avoid fields when useful
3. enforce image-complete puzzle acceptance

### Phase 3. Asset generation and storage

1. generate images with capped concurrency
2. run verification and quality gate
3. revise prompts from verifier feedback
4. persist accepted asset URLs and metadata
5. retry failed words within budget

### Phase 4. Frontend rendering

1. propagate illustration metadata into entries
2. add active-clue illustration card
3. add expanded modal
4. add browser tests

### Phase 5. Prebuilt migration

1. batch-generate prebuilt illustrations offline
2. review ambiguous words manually
3. remove themes that remain too abstract

## Open Questions

These questions remain, but each has a recommended default.

### 1. Should every clue row show a thumbnail?

Recommended default: no. Start with a single active-clue illustration card.

### 2. Should we keep optional reference metadata even if it is not the rendered asset source?

Recommended default: yes. Keep lightweight reference context when it improves prompt accuracy.

### 3. Should a puzzle with one failed image degrade gracefully or fail entirely?

Recommended default: fail illustration mode entirely. Partial completion weakens the feature promise.

### 4. Should we self-host a model or use an API provider first?

Recommended default: use an API provider first. Revisit self-hosting only after we understand volume, cost, and latency.

### 5. Should illustration generation be synchronous or asynchronous?

Recommended default: start with synchronous only if measured latency is acceptable. Otherwise switch the feature to background generation with progress UI.

### 6. How strict should verification confidence be?

Recommended default: use a conservative threshold for acceptance in illustration mode, and treat low-confidence verifier results as retry candidates rather than silent passes.

## Implementation Checklist

When implementation starts, the checklist should be:

1. finalize the new item schema
2. define the house style profile
3. update the LLM prompt to require visual context
4. extend `llm-proxy` with image-generation and multimodal verification endpoints
5. add the image-provider abstraction and prompt builder
6. add the verifier loop and structured failure taxonomy
7. implement prompt revision from verifier feedback
8. extend persistence and response payloads
9. propagate illustration metadata through the frontend generator
10. add the active-clue illustration card
11. batch-generate prebuilt puzzle assets offline
12. measure latency before deciding whether the flow can stay synchronous

## External References

These references informed the generated-image direction:

1. OpenAI image generation docs: https://developers.openai.com/api/docs/guides/image-generation
2. OpenAI image generation API notes and pricing examples: https://openai.com/index/image-generation-api/
3. GPT Image 1.5 model docs: https://developers.openai.com/api/docs/models/gpt-image-1.5
4. gpt-image-1-mini model docs: https://developers.openai.com/api/docs/models/gpt-image-1-mini
5. LLM proxy integration notes in this repo: ./docs/llm-proxy/integration.md
6. LLM proxy illustration contract in this repo: ./docs/llm-proxy/illustration-api-contract.md
7. Stability image model overview: https://stability.ai/stable-image
8. Stability license terms: https://stability.ai/license
