# ISSUES

Working backlog for this repository. Keep it current and small. Use @issues-md-format.md for the canonical format.

- Status markers: `[ ]` open, `[!]` blocked (must include a `Blocked:` line), `[x]` closed.
- Hygiene: once a closed issue's consequences are reflected in code/tests and in user-facing docs, remove the entry from this file. Git history remains the record. (Recurring runbooks below are the exception: keep them open.)

## BugFixes

## Improvements

## Maintenance

- [ ] [M001] (P0) Analyze codebase against AGENTS.FRONTEND.md and POLICY.md; produce prioritized refactoring plan.
  ### Summary
  Review the existing frontend implementation in `/projects/tenants/1078274/MarcoPoloResearchLab/llm_crossword` and identify gaps against `AGENTS.FRONTEND.md` guidance and `POLICY.md`. Produce a concrete, prioritized refactoring plan that improves maintainability, correctness, and compliance without changing product scope.
  
  ### Analysis
  This project is a browser-based JavaScript game with strict architectural and coding standards (CDN-only dependencies, ES modules, separation of `core/` and `ui/`, constants centralization, typed JSDoc with `// @ts-check`, browser-based tests, and CSP-safe patterns). The analysis should evaluate the current code against these expectations and policy requirements, including:
  
  - Structure and module boundaries (`index.html`, `js/constants.js`, `js/core/*`, `js/ui/*`, `js/app.js`, `data/*.json`, `assets/*`, `tests/*`).
  - Compliance with naming, dead-code removal, duplication control, enum/constants usage, and error/logging patterns.
  - UX and runtime behavior requirements for the allergy wheel flow (selection screen, spin/stop/restart lifecycle, timed deceleration, modal ingredient reveal, conditional audio/visual outcomes, fullscreen/mute controls, and allergy-aware dish filtering).
  - Data validation approach at boot and consistency between dish/allergen catalogs and game logic.
  - Test coverage quality (public API/DOM black-box tests, table-driven cases, assertion helpers).
  - Policy and security concerns (no inline handlers, no `eval`, CDN-only external deps, gateway boundaries for external calls).
  
  Output should distinguish:
  
  - Confirmed compliant areas.
  - Non-compliant or risky areas.
  - Ambiguities requiring clarification.
  - Refactors that are blocking vs. non-blocking.
  
  ### Deliverables
  1. A gap-analysis report mapping each relevant `AGENTS.FRONTEND.md` and `POLICY.md` requirement to current state: `Compliant`, `Partially Compliant`, or `Non-Compliant`, with file-level evidence.
  2. A prioritized refactoring plan (P0/P1/P2) with task descriptions, rationale, dependencies, and estimated effort per task.
  3. A risk register for behavior regressions (game flow, timing/animation, audio controls, fullscreen behavior, modal rendering, and data-loading paths) and proposed mitigations.
  4. A test plan defining which browser tests must be added or updated, including explicit acceptance tests for the allergy outcome logic and spin lifecycle.
  5. A definition of done for the refactor phase.
  
  Acceptance criteria:
  
  - Every recommendation is traceable to a specific requirement in `AGENTS.FRONTEND.md` or `POLICY.md`.
  - Each finding references concrete code locations (file paths and relevant symbols).
  - Plan is implementation-ready: ordered tasks, clear owners/sequence assumptions, and measurable completion criteria.
  - No scope creep beyond policy compliance, architecture alignment, and maintainability improvements.


## Features

## Planning
*do not implement yet*

