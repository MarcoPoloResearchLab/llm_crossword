# LLM crossword

A crossword puzzle builder, powered by LLM.

## Auth config

Set `GOOGLE_CLIENT_ID` in `.env.tauth.local` for local work and in `.env.tauth.production` for production deployment. `configs/config.yml` may reference env vars such as `${GOOGLE_CLIENT_ID}`, and the Go backend expands them before serving `/config.yml`. The committed `js/runtime-auth-config.js` is the production-safe browser default. Local Docker and Playwright entry points render overrides into `js/runtime-auth-config.override.js` before startup.

Direct GitHub Pages publishing uses the committed `js/runtime-auth-config.js`. If you intentionally need to regenerate that tracked file, run `bash scripts/render-runtime-auth-config.sh` without `RUNTIME_AUTH_CONFIG_PATH`. Automated local and test flows use the override file instead.

For split-origin deployments, the browser runtime config also supports explicit service URLs:

- `LLM_CROSSWORD_API_BASE_URL` — browser origin for `LLM Crossword API`
- `LLM_CROSSWORD_AUTH_BASE_URL` — browser origin for `TAuth`
- `LLM_CROSSWORD_CONFIG_URL` — public config document URL used by the frontend
- `LLM_CROSSWORD_TAUTH_SCRIPT_URL` — explicit `tauth.js` URL override

If these are unset, local startup keeps the existing same-origin behaviour by defaulting service URLs to `SITE_ORIGIN`. When `LLM_CROSSWORD_API_BASE_URL` is set and `LLM_CROSSWORD_CONFIG_URL` is not, the frontend defaults the config document to `<api-base>/config.yml`.

## GitHub Pages

The repository includes `.nojekyll` so branch-based GitHub Pages publishing can serve the static frontend directly from the repository contents without relying on a Jekyll build step or a Pages Actions workflow.

## Local Docker

Use `make up` to start the stack and `make down` to stop it. If the default site port `8000` or one of the other exposed host ports is already occupied, `make up` automatically picks the next available port and writes the resolved values to `.runtime/ports.env`.

To force a specific host port instead of auto-allocation, pass it explicitly, for example `make up CROSSWORD_PORT=8010`.

## Environment Profiles

Keep localhost and production settings separate.

- `.env.crosswordapi.local`, `.env.tauth.local`, and `tauth.config.local.yaml` are the local Docker inputs used by `make up`.
- `.env.crosswordapi.production`, `.env.tauth.production`, and `tauth.config.production.yaml` are the production profile files.
- `.runtime/config.yml`, `.runtime/tauth.config.yaml`, and `js/runtime-auth-config.override.js` are generated local-only artifacts.
- `js/runtime-auth-config.js` is the committed browser default for deployed/static environments.
- Local and production secret files stay untracked.

For the current production topology:

- frontend origin: `https://llm-crossword.mprlab.com`
- API origin: `https://llm-crossword-api.mprlab.com`
- TAuth origin: `https://tauth.mprlab.com`

Production deployments should align all three places:

1. browser runtime service URLs
2. crossword API CORS and TAuth base URL
3. TAuth CORS, tenant origins, and cookie domain

Typical production inputs are:

- crossword API:
  `CROSSWORDAPI_ALLOWED_ORIGINS=https://llm-crossword.mprlab.com`
  `CROSSWORDAPI_TAUTH_BASE_URL=https://tauth.mprlab.com`
- TAuth:
  `APP_CORS_ALLOWED_ORIGINS=https://llm-crossword.mprlab.com`
  `APP_COOKIE_DOMAIN=.mprlab.com`
  `APP_DEV_INSECURE_HTTP=false`

To render browser runtime config against a specific profile, point the script at that profile's env files:

```bash
CROSSWORDAPI_ENV_FILE=.env.crosswordapi.production \
TAUTH_ENV_FILE=.env.tauth.production \
bash scripts/render-runtime-auth-config.sh
```

## Publishing The API Image

Publish the production API image with:

```bash
make publish
```

`make publish` pushes `ghcr.io/marcopoloresearchlab/llm-crossword-api:latest`
as a multi-arch image for `linux/amd64,linux/arm64` using `backend/Dockerfile`.
When `HEAD` is exactly on a git tag, it also pushes the matching version tag.

This is the image name expected by the `mprlab-gateway` deployment contract.

## Planning Docs

- [Word Illustration Feature Plan](./docs/word-illustrations-plan.md)

## Using the Crossword

1. Choose a puzzle from the selector at the top of the page. Each puzzle loads with its own grid and clue list.
2. Click any cell and type to fill in letters. Use the arrow keys or the Tab key to move around the grid.
3. Drag the grid with the mouse or touch to pan around large puzzles.
4. Selecting a clue or a cell highlights the entire word and its clue. Solved clues are marked to show progress.
5. Press **Check** to verify your work. Correct letters are highlighted in green, while incorrect letters are marked in red.
6. Press **Reveal** to show all answers. The button toggles to **Hide** so you can return to your previous entries.
7. The status bar provides feedback after checking or revealing answers.

## License

This project is proprietary software. All rights reserved by Marco Polo Research Lab LLC.  
See the [LICENSE](./LICENSE) file for details.
