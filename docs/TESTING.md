# Testing

bentoclick has two test suites that run together via `make test`:

- **Schema tests** — `pytest` against a ClickHouse 26.3 container.
  Exercises `dashboards_raw → MV → dashboards` end-to-end including
  grants and sanitization. ~48 tests, finish in ~1s once CH is up.
- **Runtime tests** — `vitest` + `happy-dom`. Unit tests every
  exported renderer in `runtime/v1/dash.js`. ~178 tests, finish in
  ~1s after the test runner warms up. Coverage gate: 90% statements
  / lines / functions, 85% branches.

The runtime's OAuth/routing layer (`runtime/v1/spa.js`) and the
SPA's iframe RPC bridge are **not** covered by unit tests. They're
verified end-to-end via the antalya chrome-mcp + claude.ai e2e
suite (`tests/antalya/`, when added).

## Quick start

```bash
make install-deps    # one-time — creates tests/.venv and installs npm deps
make test            # full suite — ~10s with warm Docker cache
make test-schema     # pytest only — fast SQL iteration
make test-runtime    # vitest only — fast JS iteration
make coverage        # vitest with HTML report at tests/runtime/coverage/
make clean           # tear down the test container, drop caches
```

## Stack

| Layer | Tool | Why |
|---|---|---|
| Schema | `clickhouse/clickhouse-server:26.3` in Docker | Pinned tag; matches deployment target |
| Schema | `pytest` + `clickhouse-connect` | Stdlib Python ergonomics; official CH driver |
| Runtime | `vitest` + `@vitest/coverage-v8` | Fast ES-module-native test runner |
| Runtime DOM | `happy-dom` | Lightweight; no full Node/JSDOM heaviness |

Python deps live in a per-repo venv (`tests/.venv/`) because Mac
Homebrew Python is PEP 668-locked. Node deps live at the repo root
(`node_modules/`) because vitest's coverage-v8 resolves from cwd.

## Schema tests — what they cover

Each pytest gets a fresh per-test database created by `conftest.py`
fixture `ch`. Schema is applied with `${DB}` and `${SPA_ORIGIN}`
substituted. Database is dropped after the test.

| File | Asserts |
|---|---|
| `test_dashboards_table.py` | Column shape and types match v1 contract; `dashboards_raw` has no owner/updated_at; engine + sorting key; MV wires raw → target; SELECT-form insert propagates currentUser() to owner; CH 26.3 VALUES quirk documented |
| `test_roles_grants.py` | Reader role has SELECT on db.*; writer role has INSERT(<9 cols>) on `dashboards_raw` ONLY; no INSERT on `dashboards` |
| `test_sanitize_panel.py` | Each scrub pattern: script tags, iframes, event handlers, javascript: URLs; preserves benign HTML; non-html panels pass through |
| `test_mv_pipeline.py` | Full INSERT → MV → SELECT round-trip; multi-panel arrays sanitized independently; ReplacingMergeTree dedup works; owner set by MV not writer |
| `test_spec_version.py` | Default = 1; accepts any UInt8; overflow coerced (MCP-side validation responsibility) |

## Runtime tests — what they cover

Each panel renderer is exported as a pure function:
`render(panel, state, ctx) → HTMLElement`. Tests construct a fake
`state` and `ctx`, call the renderer, optionally call
`state.update(rows)`, then assert on the resulting DOM.

| File | Covers |
|---|---|
| `fmt.test.js` | Every formatter; edge cases (null, NaN, negative, very large); resolveFormatFn dotted-path lookup; applyFormat fallback |
| `interpolate.test.js` | `{{name}}` substitution with int/enum/date/string; validation errors; quote escaping; multiple placeholders |
| `panels.kpi.test.js` | Tile rendering; skeleton state; note (literal + key); format_fn; missing measurable |
| `panels.table.test.js` | Header from columns; rows + formatters; badges (descending threshold + compact form); empty_text; CSV export; tbodyEl exposed |
| `panels.bars.test.js` | Bar widths scaled to max; skeleton; empty_text; key fallbacks |
| `panels.markdown.test.js` | Heading levels; bold/italic/code/link; ul from `- `; XSS escaped; multi-block |
| `panels.hero.test.js` | Template substitution; `\|fmt` formatters; `!` highlight; missing field → em-dash; re-render on panel:loaded |
| `panels.html.test.js` | Static html verbatim; templated `{{rows[N].field}}` with HTML escape |
| `panels.script.test.js` | html shell mounts; script body executes with DASH/panel/state args; once per panel lifetime; error caught inline; async supported |
| `ledger.test.js` | add/up state; order preserved; dedup on re-add; click expands SQL row; mount-before-add re-renders |
| `runtime.error.test.js` | Param validation surfaces in slot; fetch error inline; no-query panels render synchronously; panel:loaded event; concurrent vs sequential |
| `runtime.api.test.js` | makeDashFetch (OK / Failed / Auth-expired); buildParamControls; layoutPanels; subtitle; default ids; _rerun filter; renderSpec entrypoint |
| `coverage-fill.test.js` | Defensive branches: stale epoch, non-Error throw, attachErrorHelper without title, default rootEl, packed/partial layouts |

## Coverage gates

Configured in `tests/vitest.config.ts`:

```ts
thresholds: {
  statements: 90,
  branches: 85,
  functions: 90,
  lines: 90,
}
```

Branches is 85% because v8 counts each side of every `||` and `??`
short-circuit as a separate branch, including defensive fallbacks
like `(e && e.message) || String(e)` that are intentionally hard
to trigger. Statements + lines being at 100% with branches at 88%
is the right tradeoff.

If you add a new panel type or runtime feature, its tests land in
the same PR. Coverage gates are enforced in CI; do not lower them
to make a PR pass.

## CH 26.3 quirks documented in tests

- `currentUser()` evaluated inside any expression on the
  `INSERT ... VALUES` path returns `''`. Works correctly in
  `INSERT ... SELECT`. We use SELECT-form everywhere. See
  `test_insert_values_form_owner_quirk` for the regression check.
- `CAST(json_array_string AS Array(JSON))` doesn't parse; use
  `JSONExtract(json_array_string, 'Array(JSON)')` instead.

## CI

`.github/workflows/tests.yml` runs `make test` on push and PR.
Ubuntu runner, Docker pre-installed, Python 3.12, Node 22.

Antalya deployment is manual and gated on green CI plus a clean
chrome-mcp + claude.ai e2e run.
