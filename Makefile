GO ?= go
GOFMT ?= gofmt
STATICCHECK ?= staticcheck
INEFFASSIGN ?= ineffassign
NPM ?= npm
DOCKER_COMPOSE ?= docker compose

GO_SOURCES := $(shell find backend -name '*.go' -not -path '*/vendor/*' 2>/dev/null)
GO_PACKAGES := $(shell cd backend && go list ./... 2>/dev/null)
NODE_MODULES := node_modules
BACKEND_DIR := backend
BIN_DIR := $(BACKEND_DIR)/bin

ifeq ($(CI),true)
PLAYWRIGHT_INSTALL_FLAGS := --with-deps
endif

.PHONY: format check-format lint test test-unit test-backend test-web test-web-coverage test-integration \
	playwright-install build clean ci \
	docker-up docker-down docker-logs docker-ps

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
	cd $(BACKEND_DIR) && $(GO) test ./... -cover

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
	rm -rf $(BIN_DIR) .nyc_output coverage test-results playwright-report

# ---------- CI ----------

ci: check-format lint test-backend test-web-coverage

# ---------- Docker ----------

docker-up:
	$(DOCKER_COMPOSE) up -d --build --remove-orphans

docker-down:
	$(DOCKER_COMPOSE) down

docker-logs:
	$(DOCKER_COMPOSE) logs -f

docker-ps:
	$(DOCKER_COMPOSE) ps
