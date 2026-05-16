#!/usr/bin/env bash
# tests/run.sh — bring up ClickHouse 26.3, run pytest, run vitest, tear down.
#
# Used by `make test` and `.github/workflows/tests.yml`. Exits non-zero on
# any pytest failure, any vitest failure, or coverage below 90%.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# Activate the local venv if present (created by `make install-deps`).
if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

CH_HTTP_PORT="${CH_HTTP_PORT:-18123}"
CH_TCP_PORT="${CH_TCP_PORT:-19000}"
export CH_HTTP_PORT CH_TCP_PORT

# Prefer `docker compose` (v2 plugin) over `docker-compose` (v1).
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
else
  DC=(docker-compose)
fi

cleanup() {
  echo "==> tearing down clickhouse test container"
  "${DC[@]}" -f docker-compose.test.yml down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> starting clickhouse:26.3 on :${CH_HTTP_PORT} (http) :${CH_TCP_PORT} (tcp)"
"${DC[@]}" -f docker-compose.test.yml up -d

echo "==> waiting for clickhouse /ping"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:${CH_HTTP_PORT}/ping" >/dev/null 2>&1; then
    echo "    clickhouse healthy after ${i}s"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: clickhouse did not become healthy in 60s" >&2
    "${DC[@]}" -f docker-compose.test.yml logs --tail=80
    exit 1
  fi
  sleep 1
done

SCHEMA_DIR_HAS_SQL=0
if compgen -G "../schema/*.sql" > /dev/null; then
  SCHEMA_DIR_HAS_SQL=1
fi

echo "==> running pytest tests/schema/"
if compgen -G "schema/test_*.py" > /dev/null; then
  if [ "$SCHEMA_DIR_HAS_SQL" -eq 0 ]; then
    echo "WARN: tests/schema/*.py exist but schema/*.sql does not — schema fixture will fail" >&2
  fi
  pytest schema -v
else
  echo "    no schema tests yet — skipping"
fi

echo "==> running vitest with coverage"
if compgen -G "runtime/unit/*.test.js" > /dev/null || compgen -G "e2e/*.test.js" > /dev/null; then
  (cd runtime && npx --no-install vitest run --coverage)
else
  echo "    no runtime tests yet — skipping"
fi

echo "==> all suites green"
