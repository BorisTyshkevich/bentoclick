.PHONY: help test test-schema test-runtime coverage clean lint install-deps up down

CH_HTTP_PORT ?= 18123
CH_TCP_PORT  ?= 19000

help:
	@echo "bentoclick — make targets"
	@echo ""
	@echo "  make test          Full suite: schema (pytest) + runtime (vitest)"
	@echo "  make test-schema   pytest tests/schema/ against CH 26.3 in Docker"
	@echo "  make test-runtime  vitest run --coverage tests/runtime/"
	@echo "  make coverage      Same as test-runtime; HTML report at tests/runtime/coverage/"
	@echo "  make up            Start the ClickHouse test container in background"
	@echo "  make down          Stop and remove the test container"
	@echo "  make clean         make down + remove caches and coverage artifacts"
	@echo "  make install-deps  pip install -r tests/requirements.txt && npm --prefix tests install"

install-deps:
	pip install -r tests/requirements.txt
	cd tests && npm install

up:
	docker compose -f tests/docker-compose.test.yml up -d
	@echo "Waiting for ClickHouse on :$(CH_HTTP_PORT)..."
	@for i in $$(seq 1 30); do \
	  curl -fsS "http://localhost:$(CH_HTTP_PORT)/ping" >/dev/null 2>&1 && exit 0; \
	  sleep 1; \
	done; \
	echo "ClickHouse did not become healthy in 30s" >&2; exit 1

down:
	docker compose -f tests/docker-compose.test.yml down -v

test-schema: up
	pytest tests/schema -v
	@$(MAKE) down

test-runtime:
	cd tests && npx vitest run --coverage

coverage: test-runtime
	@echo "Coverage report at tests/runtime/coverage/index.html"

test:
	@./tests/run.sh

clean: down
	rm -rf tests/runtime/coverage tests/.cache tests/clickhouse-data
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type d -name .pytest_cache -prune -exec rm -rf {} +
