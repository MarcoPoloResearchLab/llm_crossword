# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## [v0.1.2] - 2026-03-31

### Features ✨
- _No changes._

### Improvements ⚙️
- Updated default TAuth URLs to use `https://tauth-api.mprlab.com` as auth base URL.
- Changed default `tauth.js` CDN fallback to a pinned CDN URL for better reliability.
- Enhanced runtime configuration script to default `tauth.js` to the pinned CDN helper when unset.

### Bug Fixes 🐛
- _No changes._

### Testing 🧪
- _No changes._

### Docs 📚
- Clarified environment variable descriptions regarding TAuth URLs and script overrides.
- Updated documentation with new default URLs for production deployments.

## [v0.1.1] - 2026-03-31

### Features ✨
- Expand environment variables (e.g. `${GOOGLE_CLIENT_ID}`) in `config.yml` before serving and loading in Go backend.
- Added error handling for missing environment variables during configuration expansion.

### Improvements ⚙️
- Updated public config endpoint to serve expanded YAML with environment variables replaced.
- Cleaned up runtime auth config rendering script, removing embedded Google client ID and related resolution logic.
- Updated README and sample configs to document environment variable expansion in config file.

### Bug Fixes 🐛
- Fail startup or config load gracefully if required environment variables are missing.
- Prevent invalid config serving by expanding and validating env vars in config YAML.

### Testing 🧪
- Added tests for environment variable expansion in config file loading.
- Added tests for public config endpoint behavior with environment variable interpolation and error on missing vars.

### Docs 📚
- Clarified environment variable usage in `README.md` auth config section.
- Documented config file env var expansion behavior in `configs/config.yml`.

## [v0.1.0] - 2026-03-31

### Features ✨
- Add LLM-powered crossword generation with authentication and credit system
- Implement puzzle persistence with GORM + SQLite and share links
- Support split-origin service URLs and unify API URL construction
- Add admin panel with user management, credit granting, and audit tools
- Add multi-arch Docker image publishing to GHCR
- Add responsive crossword layout and controls for small screens

### Improvements ⚙️
- Improve session restore and tenant-aware authentication plumbing
- Refine crossword layout and improve compactness with weighted scoring
- Enhance billing UX and header puzzle controls
- Add credits and billing backend APIs with refunds on generation failure
- Add test coverage enforcement and improve CI environment profiles

### Bug Fixes 🐛
- Fix crossword grid layout and empty space issues
- Correct billing checkout return URLs and credit checks
- Fix theme toggle, login flow, and staticcheck lint warnings
- Resolve clue layout and hint toggle usability bugs

### Testing 🧪
- Add comprehensive test suite with 100% coverage including Playwright E2E tests
- Add blackbox integration tests with docker orchestration
- Refactor E2E tests to use route-based mocking via shared helpers
- Add regression tests for view state and content clipping

### Docs 📚
- Document legal and illustration integration updates
- Add user guide and integration documentation
- Maintain changelogs with contributions and issue planning notes
