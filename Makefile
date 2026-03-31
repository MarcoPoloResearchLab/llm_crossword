GO ?= go
GOFMT ?= gofmt
STATICCHECK ?= staticcheck
INEFFASSIGN ?= ineffassign
NPM ?= npm
DOCKER_COMPOSE ?= docker compose
COMPOSE_UP_ARGS ?=
COMPOSE_DOWN_ARGS ?=
LOCAL_CROSSWORDAPI_ENV_FILE ?= .env.crosswordapi.local
LOCAL_TAUTH_ENV_FILE ?= .env.tauth.local
LOCAL_TAUTH_CONFIG_TEMPLATE ?= tauth.config.local.yaml

GO_SOURCES := $(shell find backend -name '*.go' -not -path '*/vendor/*' 2>/dev/null)
GO_PACKAGES := $(shell cd backend && go list ./... 2>/dev/null)
NODE_MODULES := node_modules
BACKEND_DIR := backend
BIN_DIR := $(BACKEND_DIR)/bin
RUNTIME_DIR := .runtime

ifeq ($(CI),true)
PLAYWRIGHT_INSTALL_FLAGS := --with-deps
endif

.PHONY: format check-format lint test test-unit test-backend test-web test-web-coverage test-integration \
	playwright-install build clean ci \
	up down logs ps docker-up docker-down docker-logs docker-ps

# ---------- Formatting ----------

format:
	$(GOFMT) -w $(GO_SOURCES)

check-format:
	@formatted="$$($(GOFMT) -l $(GO_SOURCES))"; \
	if [ -n "$$formatted" ]; then \
		echo 'Go files require formatting:'; \
		echo "$$formatted"; \
		exit 1; \
	fi

# ---------- Linting ----------

lint:
	@command -v $(STATICCHECK) >/dev/null 2>&1 || { echo 'staticcheck is required (install via `go install honnef.co/go/tools/cmd/staticcheck@latest`)'; exit 1; }
	@command -v $(INEFFASSIGN) >/dev/null 2>&1 || { echo 'ineffassign is required (install via `go install github.com/gordonklaus/ineffassign@latest`)'; exit 1; }
	cd $(BACKEND_DIR) && $(GO) vet ./...
	cd $(BACKEND_DIR) && $(STATICCHECK) ./...
	cd $(BACKEND_DIR) && $(INEFFASSIGN) ./...

# ---------- Testing ----------

test-backend:
	cd $(BACKEND_DIR) && $(GO) test ./... -coverprofile=coverage.out
	@coverage="$$(cd $(BACKEND_DIR) && $(GO) tool cover -func=coverage.out | awk '/^total:/ { print $$3 }')"; \
	if [ "$$coverage" != "100.0%" ]; then \
		echo "Go coverage must be 100.0% (got $$coverage)"; \
		exit 1; \
	fi

$(NODE_MODULES): package-lock.json
	$(NPM) ci --foreground-scripts

playwright-install:
	npx playwright install $(PLAYWRIGHT_INSTALL_FLAGS) chromium

test-web: $(NODE_MODULES)
	$(MAKE) playwright-install
	$(NPM) test

test-web-coverage: $(NODE_MODULES)
	$(MAKE) playwright-install
	$(NPM) run test:coverage

test-integration: $(NODE_MODULES)
	$(MAKE) playwright-install
	$(NPM) run test:integration

test-unit: test-backend test-web

test: test-unit test-integration

# ---------- Build ----------

build:
	mkdir -p $(BIN_DIR)
	cd $(BACKEND_DIR) && $(GO) build -o bin/crossword-api ./cmd/crossword-api

clean:
	rm -rf $(BIN_DIR) .nyc_output coverage test-results playwright-report $(BACKEND_DIR)/coverage.out

# ---------- CI ----------

ci: check-format lint test-backend test-web-coverage

# ---------- Docker ----------

up:
	@set -eu; \
	for env_file in "$(LOCAL_CROSSWORDAPI_ENV_FILE)" "$(LOCAL_TAUTH_ENV_FILE)"; do \
		if [ ! -f "$$env_file" ]; then \
			echo "Missing $$env_file."; \
			exit 1; \
		fi; \
	done; \
	if [ ! -f "$(LOCAL_TAUTH_CONFIG_TEMPLATE)" ]; then \
		echo "Missing $(LOCAL_TAUTH_CONFIG_TEMPLATE)."; \
		exit 1; \
	fi; \
	if [ -f config.yaml ]; then \
		echo "Legacy root config.yaml is not allowed. Move public config to configs/config.yml."; \
		exit 1; \
	fi; \
	if rg -n '^[[:space:]]*administrators:' configs/config.yml >/dev/null 2>&1; then \
		echo "configs/config.yml is public and must not contain administrators. Move admin emails to CROSSWORDAPI_ADMIN_EMAILS in $(LOCAL_CROSSWORDAPI_ENV_FILE)."; \
		exit 1; \
	fi; \
	if find . -maxdepth 1 -type f -name 'client_secret_*.json' | grep -q .; then \
		echo "Refusing to start: repo-root client_secret_*.json would be served by ghttp. Move OAuth client secret files outside the repo root."; \
		exit 1; \
	fi; \
	port_in_use() { \
		lsof -nP -iTCP:"$$1" -sTCP:LISTEN >/dev/null 2>&1; \
	}; \
	port_owner() { \
		lsof -nP -iTCP:"$$1" -sTCP:LISTEN | tail -n +2 | head -n 1; \
	}; \
	port_reserved() { \
		target="$$1"; \
		shift; \
		for reserved in "$$@"; do \
			if [ "$$reserved" = "$$target" ]; then \
				return 0; \
			fi; \
		done; \
		return 1; \
	}; \
	next_free_port() { \
		port="$$1"; \
		shift; \
		while :; do \
			if port_reserved "$$port" "$$@"; then \
				port=$$((port + 1)); \
				continue; \
			fi; \
			if command -v lsof >/dev/null 2>&1 && port_in_use "$$port"; then \
				port=$$((port + 1)); \
				continue; \
			fi; \
			break; \
		done; \
		printf '%s\n' "$$port"; \
	}; \
	resolve_port() { \
		label="$$1"; \
		requested="$$2"; \
		explicit="$$3"; \
		shift 3; \
		if port_reserved "$$requested" "$$@"; then \
			if [ -n "$$explicit" ]; then \
				echo "$$label port $$requested conflicts with another llm_crossword host port." >&2; \
				exit 1; \
			fi; \
			resolved=$$(next_free_port "$$((requested + 1))" "$$@"); \
			echo "$$label port $$requested conflicts with another llm_crossword host port; using $$resolved instead." >&2; \
			printf '%s\n' "$$resolved"; \
			return 0; \
		fi; \
		if command -v lsof >/dev/null 2>&1 && port_in_use "$$requested"; then \
			owner=$$(port_owner "$$requested"); \
			if [ -n "$$explicit" ]; then \
				echo "$$label port $$requested is already in use." >&2; \
				if [ -n "$$owner" ]; then \
					echo "$$owner" >&2; \
				fi; \
				exit 1; \
			fi; \
			resolved=$$(next_free_port "$$((requested + 1))" "$$@"); \
			echo "$$label port $$requested is already in use; using $$resolved instead." >&2; \
			if [ -n "$$owner" ]; then \
				echo "Current listener on $$requested: $$owner" >&2; \
			fi; \
			printf '%s\n' "$$resolved"; \
			return 0; \
		fi; \
		printf '%s\n' "$$requested"; \
	}; \
	mkdir -p "$(RUNTIME_DIR)"; \
	ledger_requested_port="$${LEDGER_HOST_PORT:-50051}"; \
	ledger_explicit_port="$${LEDGER_HOST_PORT:-}"; \
	ledger_resolved_port=$$(resolve_port "Ledger host" "$$ledger_requested_port" "$$ledger_explicit_port"); \
	tauth_requested_port="$${TAUTH_HOST_PORT:-8081}"; \
	tauth_explicit_port="$${TAUTH_HOST_PORT:-}"; \
	tauth_resolved_port=$$(resolve_port "TAuth host" "$$tauth_requested_port" "$$tauth_explicit_port" "$$ledger_resolved_port"); \
	api_requested_port="$${CROSSWORD_API_HOST_PORT:-9090}"; \
	api_explicit_port="$${CROSSWORD_API_HOST_PORT:-}"; \
	api_resolved_port=$$(resolve_port "Crossword API host" "$$api_requested_port" "$$api_explicit_port" "$$ledger_resolved_port" "$$tauth_resolved_port"); \
	site_requested_port="$${CROSSWORD_PORT:-8000}"; \
	site_explicit_port="$${CROSSWORD_PORT:-}"; \
	site_resolved_port=$$(resolve_port "Crossword site" "$$site_requested_port" "$$site_explicit_port" "$$ledger_resolved_port" "$$tauth_resolved_port" "$$api_resolved_port"); \
	export LEDGER_HOST_PORT="$$ledger_resolved_port"; \
	export TAUTH_HOST_PORT="$$tauth_resolved_port"; \
	export CROSSWORD_API_HOST_PORT="$$api_resolved_port"; \
		export CROSSWORD_PORT="$$site_resolved_port"; \
		export SITE_ORIGIN="http://localhost:$$site_resolved_port"; \
		export CROSSWORDAPI_ENV_FILE="./$(LOCAL_CROSSWORDAPI_ENV_FILE)"; \
		export TAUTH_ENV_FILE="./$(LOCAL_TAUTH_ENV_FILE)"; \
		export TAUTH_CONFIG_TEMPLATE="./$(LOCAL_TAUTH_CONFIG_TEMPLATE)"; \
		export APP_CONFIG_SOURCE="./$(RUNTIME_DIR)/config.yml"; \
		export PUBLIC_CONFIGS_SOURCE="./$(RUNTIME_DIR)/public-configs"; \
		export TAUTH_CONFIG_SOURCE="./$(RUNTIME_DIR)/tauth.config.yaml"; \
	export RUNTIME_AUTH_CONFIG_PATH="js/runtime-auth-config.override.js"; \
	bash ./scripts/render-runtime-auth-config.sh; \
	bash ./scripts/render-runtime-compose-configs.sh; \
	$(DOCKER_COMPOSE) up -d --build --remove-orphans $(COMPOSE_UP_ARGS); \
	echo "llm_crossword is starting on $$SITE_ORIGIN"; \
	echo "Host sidecars: TAuth=http://localhost:$$TAUTH_HOST_PORT API=http://localhost:$$CROSSWORD_API_HOST_PORT Ledger=localhost:$$LEDGER_HOST_PORT"; \
	echo "Resolved ports written to $(RUNTIME_DIR)/ports.env"

down:
	$(DOCKER_COMPOSE) down --remove-orphans $(COMPOSE_DOWN_ARGS)
	rm -rf $(RUNTIME_DIR)

logs:
	$(DOCKER_COMPOSE) logs -f

ps:
	$(DOCKER_COMPOSE) ps

docker-up: up

docker-down: down

docker-logs: logs

docker-ps: ps
