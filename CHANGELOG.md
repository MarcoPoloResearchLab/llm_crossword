# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

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
