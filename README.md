# bentoclick

Compartmentalized ClickHouse dashboards. Save a small JSON spec, get a
shareable URL — the SPA fetches the row at view time and renders panels
against ClickHouse as the viewer.

Designed to be authored by agents through MCP: the dashboard table is the
API surface, and the MCP write tool reflects its columns into typed tool
parameters.

## Status

**Early development — v1 in progress.** No production users. Schema,
runtime, and authoring skill are converging on the design ratified in
`docs/SPEC_VERSIONING.md` and `docs/SANITIZATION.md`. Do not adopt yet.

## Quick install

Once `make test` is green, run:

```bash
./install.sh \
  --ch-host=<host>:<port> \
  --ch-user=<admin> \
  --mcp-url=<https://...-mcp.../mcp> \
  --spa-origin=<https://...> \
  --acm-cluster-id=<id>
```

The installer:

1. Applies `schema/01-database.sql` and `schema/02-roles.sql`.
2. Pushes the runtime assets under `/lib/v1/` on the CH HTTPS server.
3. Splices the dashboard HTTP handlers into ClickHouse's `user_files`
   handler chain.
4. Inserts the four sample dashboards through the sanitizing MV.

## Running tests

```bash
make test          # full suite — ~2-3 min with Docker pull warm
make test-schema   # pytest only — fast SQL iteration
make test-runtime  # vitest only — fast JS iteration
make coverage      # vitest with HTML report at tests/runtime/coverage/
make clean         # tear down the test container
```

Test stack: ClickHouse 26.3 in Docker, `pytest` + `clickhouse-connect`
for schema/SQL, `vitest` + `happy-dom` for the runtime. Coverage gate is
**90%** across statements, branches, functions, and lines.

## Repo layout

```
bentoclick/
├── schema/          # CREATE TABLE / GRANT (versioned via spec_version)
├── handlers/        # ClickHouse HTTP handler XML
├── runtime/v1/      # SPA shell + dash.js renderer for spec_version=1
├── config/          # config.json / client.json templates
├── samples/         # sample spec JSON files
├── skills/          # altinity-dash-builder Claude skill
├── docs/            # SPEC_VERSIONING, SANITIZATION, TESTING, AUTHORING
└── tests/           # pytest (schema) + vitest (runtime) + e2e
```

## Authoring dashboards

Install the skill:

```bash
ln -s "$(pwd)/skills/altinity-dash-builder" \
      ~/.claude/skills/altinity-dash-builder
```

Then ask Claude Code to build a dashboard. The skill teaches the seven
panel types (`kpi-strip`, `table`, `bars`, `markdown`, `hero`, `html`,
`script`) and routes through the reflected MCP write tool.

## License

Apache 2.0 — see `LICENSE`.
