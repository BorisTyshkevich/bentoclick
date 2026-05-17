# Save flow

## v1 schema — write through `dashboards_raw`

The writer role has INSERT only on `dashboards.dashboards_raw` (Null
engine). A materialized view (`dashboards_mv`) sanitizes the panels
(strips `<script>`, `<iframe>`, `on*` event handlers, `javascript:`
URLs) and writes to `dashboards.dashboards` with `owner = currentUser()`
and `updated_at = now()` computed at the MV layer.

There is **no** direct INSERT path to `dashboards.dashboards` — the
writer role doesn't have that grant.

## Two write paths

### 1. Reflected MCP write tool (preferred)

The altinity-mcp server reflects `dashboards_raw` into a typed
`save_*_dashboard` tool. Parameters mirror the columns:

| Param | Type | Notes |
|---|---|---|
| `slug` | string | kebab-case URL identifier |
| `title` | string | human-readable title |
| `subtitle` | string | optional muted line below title |
| `concurrent` | boolean | run panel queries in parallel (default false) |
| `spec_version` | integer (1–255) | runtime contract version; **pin to 1** for v1 |
| `params` | array of JSON | toolbar param definitions |
| `panels` | array of JSON | panel objects |
| `meta` | JSON object | arbitrary dashboard-wide metadata |
| `tags` | array of string | grouping/filtering tags |

Call the tool with the spec values as separate args — no SQL needed.

### 2. Direct SQL (fallback)

If the reflected tool isn't available, INSERT into `dashboards_raw`.

```sql
INSERT INTO dashboards.dashboards_raw
  (slug, title, subtitle, spec_version, params, panels)
SELECT
  'us-airline-ontime',
  'US Airline On-Time',
  'BTS ontime — pick a year for the snapshot.',
  1,
  JSONExtract('[{"name":"year","type":"int","default":2023,"min":1987,"max":2025}]', 'Array(JSON)'),
  JSONExtract('[{"id":"kpis","type":"kpi-strip","query":"...","tiles":[...]}, ...]', 'Array(JSON)');
```

**Critical:** use `INSERT ... SELECT`, never `INSERT ... VALUES`. CH
26.3 has a bug where `currentUser()` evaluated in the VALUES path
returns `''`, so `owner` ends up empty on the stored row. SELECT-form
preserves the user context. (Tracked in `tests/schema/test_dashboards_table.py::test_insert_values_form_owner_quirk`.)

`Array(JSON)` doesn't cast directly from a raw JSON-array string;
`JSONExtract(<string>, 'Array(JSON)')` is the correct constructor.

## What gets sanitized at write time

The MV's `sanitize_panel(panel)` function strips:

- `<script>...</script>` (with attributes, self-closing, multi-line,
  uppercase variants)
- `<iframe>...</iframe>` and orphan opening tags
- `<object>...</object>`, `<embed/>`
- `on*="..."` and `on*='...'` event-handler attributes
- `javascript:` URL protocols

It does **not** sanitize the body of `type='script'` panels — those
pass through unchanged in v1 (open-to-all-viewers trust model). v2
will add per-row ACL gating on script execution.

## Share URL — read from `dashboards.whoami`

```sql
SELECT spa_origin, localpart, my_dashboards_prefix FROM dashboards.whoami;
```

Returns `email`, `localpart`, `spa_origin`, `my_dashboards_prefix`.
The share URL is `<my_dashboards_prefix><slug>` (equivalent to
`<spa_origin>/v/<localpart>/<slug>`).

**Never guess the host.** The MCP origin and the SPA origin are
different. `whoami` resolves this with one query — cache it once
per conversation.

## Edit by re-INSERT

INSERT a new row with the same slug under the same owner. New row
lands at the same `(owner, slug)` key with a later `updated_at`;
`ReplacingMergeTree FINAL` returns the latest. URL unchanged.

## Listing

```sql
-- mine
SELECT slug, title, spec_version, updated_at
FROM dashboards.dashboards FINAL
WHERE owner = currentUser()
ORDER BY updated_at DESC;

-- everyone visible to me (reader role: SELECT on the whole db)
SELECT owner, slug, title, updated_at
FROM dashboards.dashboards FINAL
ORDER BY updated_at DESC LIMIT 50;
```

## Constraints

- Slug: kebab-case. Shows up in the URL.
- Title: free text. Becomes `<title>` and `<h1>`.
- `spec_version`: integer 1–255. Pin to 1 for v1.
- panels[*].type ∈ {`kpi-strip`, `table`, `bars`, `markdown`,
  `hero`, `html`, `script`}. Unknown types render an error tile.
