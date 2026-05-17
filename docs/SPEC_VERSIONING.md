# spec_version — runtime contract versioning

Every dashboard row carries a `spec_version` (UInt8, default 1). The
SPA reads it and loads `/lib/v<spec_version>/dash.js` to render. This
lets old dashboards keep working forever while new dashboards opt
into newer runtime contracts.

## The contract

`spec_version = N` means **"this dashboard's `panels` and `params`
match what the v<N> runtime expects."** Concretely, the v1 contract
guarantees:

- Panel types: `kpi-strip`, `table`, `bars`, `markdown`, `hero`,
  `html`, `script`. Unknown types render an error tile.
- Param types: `int`, `enum`, `date`, `string`. Strict per-type
  validation at substitution time.
- `{{name}}` substitution everywhere SQL is templated.
- Sanitization at the MV layer strips `<script>`, `<iframe>`,
  `<object>`, `<embed>`, `on*=` event handlers, `javascript:` URLs
  from `html` panels.
- `script` panels execute as the viewer with no ACL gating
  (open-to-all-viewers v1 trust model).

## How the runtime is selected

The SPA's `synthesizeSpecWrapper` (in `runtime/v1/spa.js`) reads the
row's `spec_version` and emits:

```html
<script type="module">
  import { renderSpec } from "/lib/v<N>/dash.js";
  renderSpec(<spec>, document.getElementById("dash-root"));
</script>
```

For v1, this points at `/lib/v1/dash.js`. For v2 (when it lands),
new dashboards saved with `spec_version: 2` will load
`/lib/v2/dash.js`. Old v1 dashboards still load v1.

## When to bump

Bump the contract version when:

- A panel-type's shape changes incompatibly (renaming/removing a
  field, changing what a value means).
- A panel-type is removed.
- A spec-level field changes meaning.
- Sanitization rules tighten in a way that would silently break old
  HTML panels.

Don't bump for:

- Adding a new panel type that nothing else relies on.
- Adding a new optional field to an existing panel type.
- Adding a new formatter.
- Bug fixes to renderers that don't change the contract.

Most additive changes can land in v1 without a version bump.

## Writer requirements

The reflected MCP write tool exposes `spec_version` as a typed
parameter (UInt8, 1–255). Agents should pin it explicitly:
`spec_version: 1` for the current contract. Future agents that know
about v2 can pin `spec_version: 2`.

The DB layer is permissive — it accepts any UInt8 — so MCP tool
validation is the bouncer for sane ranges.

## Runtime refuses unknown future versions

If a dashboard pins `spec_version: 7` and the SPA only has
`/lib/v1/` and `/lib/v2/`, the `import { renderSpec } from
"/lib/v7/dash.js"` fails (404). The wrapper script catches the
import error and renders an "unknown spec version" message rather
than a blank page.

The reverse is fine: a v2 runtime can render a v1 dashboard if it
keeps the v1 contract internally — but the *cleanest* policy is to
never let v2+ runtimes render v1 dashboards. They route via
`/lib/v1/dash.js` instead.

## File layout

```
runtime/
└── v1/
    ├── dash.js              # v1 runtime
    ├── dash-theme.css
    ├── spa.js               # SPA shell (version-agnostic for now)
    ├── spa.html
    └── oauth-callback.html
```

When v2 lands, `runtime/v2/` sits alongside `runtime/v1/`. Both are
served under `/lib/v1/` and `/lib/v2/` by the install script. SPA
shell may or may not version-bump separately.
