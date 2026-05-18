# Sanitization architecture

bentoclick stores dashboards as typed columns and writes pass
through a materialized view that strips dangerous HTML constructs
from `html` panel content before the row lands in the read table.
This document explains the threat model, the implementation, and
the deliberate gaps.

## Goals

- **No path to `dashboards` skips sanitization.** Writer role has
  INSERT only on `dashboards_raw` (Null engine). The MV is the only
  producer of rows in `dashboards`.
- **Sanitization is server-side and unbypassable.** Client-side
  sanitization in the SPA is *not* a security boundary — anyone with
  ClickHouse credentials could otherwise bypass it.
- **Stored XSS is closed.** A malicious or compromised author can't
  save a dashboard whose `html` panel exfiltrates other viewers'
  bearer tokens.

## Non-goals

- Sanitizing `script` panels. v1 trust model lets any viewer execute
  owner-authored JS — sandboxed iframe limits the blast radius
  (no `parent.*`, no `localStorage`, no cookies, no token access).
  v2 will gate `script` execution via a per-row ACL.
- Defending against denial-of-service via expensive SQL. Per-user
  CH quota / max_execution_time / row-count limits live elsewhere.
- Stopping malicious queries by a legitimate viewer. The dashboard
  runs SQL as the viewer; viewers can already run any SQL their
  role allows directly.

## Architecture

```
                   INSERT INTO dashboards_raw
                            |
                            v
        dashboards_raw    (Null engine — discards inserted block)
                            |
        + on-insert fires the materialized view ↓
                            |
        dashboards_mv  ┌── arrayMap(p -> sanitize_panel(p), panels)
                       ├── currentUser() → owner
                       └── now() → updated_at
                            |
                            v
                   INSERT INTO dashboards  (read target)
```

The Null engine on `dashboards_raw` discards the inserted block, but
on-insert MVs still fire. The MV's SELECT produces the sanitized
rows; those land in `dashboards` (ReplacingMergeTree).

## sanitize_panel

`sanitize_panel(panel)` is a global SQL FUNCTION defined in
`schema/01-database.sql`. It works on the JSON string representation
(`toJSONString(panel)`) and uses re2 `replaceRegexpAll` calls to
neutralize known-dangerous constructs:

| Construct | Pattern (regex) |
|---|---|
| `<script>...</script>` | `(?is)<script\b[^>]*>.*?<\\?/script[^>]*>` |
| Self-closing `<script ... />` | `(?is)<script\b[^>]*\\?/>` |
| `<iframe>...</iframe>` | `(?is)<iframe\b[^>]*>.*?<\\?/iframe[^>]*>` |
| Orphan `<iframe ...>` | `(?is)<iframe\b[^>]*>` |
| `<object>...</object>` | `(?is)<object\b[^>]*>.*?<\\?/object[^>]*>` |
| `<embed ... />` | `(?is)<embed\b[^>]*\\?/?>` |
| Double-quoted `on*="..."` | `(?i)\bon[a-z]+\s*=\s*\\?"[^\\?"]*\\?"` |
| Single-quoted `on*='...'` | `(?i)\bon[a-z]+\s*=\s*'[^']*'` |
| `javascript:` URL protocol | `(?i)javascript:` |

The `\\?` before each `/` handles the fact that
`toJSONString()` escapes `/` as `\/` inside string values per JSON
convention.

After scrubbing, the result is `CAST(... AS JSON)` and propagated to
the target row's `panels` array via `arrayMap`.

### Non-html panels pass through

The regex applies to the full JSON, but `kpi-strip`, `table`, `bars`,
`markdown`, `hero`, and `script` panels don't legitimately contain
the targeted patterns. A query string containing the literal text
`<script>` (unlikely but possible) would be corrupted; this is the
acceptable tradeoff for a regex-only sanitizer.

### What the tests pin

`tests/schema/test_sanitize_panel.py` exercises every pattern
individually. `tests/schema/test_mv_pipeline.py` exercises the
full INSERT → MV → SELECT round-trip.

## What the writer role can do

```sql
GRANT INSERT(slug, title, subtitle, concurrent, spec_version,
             params, panels, meta, tags)
   ON dashboards.dashboards_raw
   TO dashboards_writer_role;
```

No INSERT on `dashboards`. No INSERT on the MV. No way to skip the
sanitizer.

The reader role gets SELECT on the whole database (the SPA needs to
read both `dashboards` and `dashboards_prefix`).

## Defense in depth

Server-side sanitization is the primary guarantee. Additional
defenses:

- The SPA's `synthesizeSpecWrapper` HTML-escapes the spec JSON when
  inlining it into the iframe's `<script type="module">`. This stops
  a `</script>` breakout payload even if it somehow survived the
  MV (it can't, because `<script>` is the first pattern stripped).
- The iframe runs under `sandbox="allow-scripts allow-popups
  allow-popups-to-escape-sandbox allow-forms"` with no
  `allow-same-origin`. JS executes but has a null origin — no access
  to the parent's `localStorage`, cookies, or the bearer token.
- `script` panels go through `new Function(...)` with no `eval` and
  no access to `parent.*` from within the iframe. Errors thrown by
  the script body are caught and rendered inline rather than
  killing the page.

## Things that would break the model

Don't do these without thinking very carefully:

- Granting INSERT on `dashboards` to anyone but the MV's definer.
- Disabling the sandbox attribute on the SPA iframe.
- Adding new panel types whose content is rendered as HTML without
  extending `sanitize_panel`.
- Bypassing `dashboards_raw` to write panels directly (e.g. by
  exposing an admin-only insert path).

When `script` panel ACL lands in v2, the rules tighten: only the
owner (and explicitly-granted viewers) execute the JS; everyone else
sees a placeholder.

## Tests as canonical behavior

Anything not covered by `tests/schema/test_sanitize_panel.py` is not
guaranteed. If a new XSS vector emerges, the fix lands as a new
regex *and* a new test case in the same PR.
