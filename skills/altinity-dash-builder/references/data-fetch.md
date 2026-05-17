# `CH_FETCH` / `DASH.fetch`

This is the low-level data-fetch API used by **HTML mode** and by
**hybrid `content` fragments**. In **spec mode** the runtime fires
panel queries for you — most authors never call these directly. Spec
mode dashboards reach for `DASH.spec.fetch(label, sql)` instead (see
`spec-mode.md` § Hybrid mode for the `DASH.spec.*` API).

The SPA injects two globals into every dashboard's iframe:

```js
window.CH_ENDPOINT  // string — ClickHouse HTTPS base
window.CH_FETCH     // async (sql) => ({cols, rows, count})
```

`CH_FETCH` is a postMessage RPC to the SPA shell, which holds the bearer
token and makes the authenticated request. The iframe never sees the
credential.

## Prefer `DASH.fetch`

```js
const r = await DASH.fetch(id, label, sql);
// id    — short stable id used as the ledger key
// label — human description shown in the ledger
// sql   — the SQL string
```

Same return shape as `CH_FETCH` but also adds a ledger entry and marks
it OK / Failed.

## Return shape

```js
{
  cols:  ['day', 'n'],
  rows:  [{day:'2026-04-01', n:42}, ...],   // row-as-object
  count: 14
}
```

## Rejection

- `Error('Auth expired')` on 401/403 — shell handles reauth, bail silently.
- `Error('HTTP NNN: …')` on other non-2xx — show a slice in the status bar.
- `Error('Query timed out')` after 30s.

## `DASH.fmt` helpers

```js
DASH.fmt.num(v)   // '12,345'
DASH.fmt.pct(v)   // '42.0%' (pass a fraction 0..1)
DASH.fmt.esc(s)   // HTML-escape
DASH.fmt.day(v)   // 'YYYY-MM-DD' from Date or DateTime
```
