-- bentoclick — dashboard storage layer.
--
-- ${DB} is the dashboard database (default: `dashboards`); ${SPA_ORIGIN}
-- is the public origin of the ClickHouse HTTPS server hosting the SPA.
-- Both are substituted by `install.sh` (or `tests/conftest.py` in test
-- runs) before this file is applied.
--
-- Three storage objects make up the dashboard write path:
--
--   dashboards_raw  Null engine — write target for tools/agents.
--                   Payload columns (params, panels, meta, tags) are
--                   stored as STRING (JSON-encoded text) so the
--                   altinity-mcp reflector — which intentionally skips
--                   JSON / Array(JSON) types — sees plain string
--                   parameters that map cleanly to MCP tool args.
--                                |
--                                v
--   dashboards_mv   Materialized view — sanitizes the panels JSON text
--                   then JSONExtract's into the read target's
--                   structured types.
--                                |
--                                v
--   dashboards     ReplacingMergeTree — read target for the SPA. Keeps
--                                       structured types (Array(JSON),
--                                       JSON, Array(String)) for fast
--                                       column access from the SPA's
--                                       SELECT.
--
-- Direct INSERT into `dashboards` is denied to the writer role — there
-- is no path that bypasses the MV.

CREATE DATABASE IF NOT EXISTS ${DB};

-- Read target. Structured payload columns + owner/updated_at supplied
-- by the MV. owner and updated_at are DEFAULT (not MATERIALIZED) so
-- the MV's SELECT can supply them explicitly; column-level grants
-- prevent forgery (no INSERT(owner) is ever granted anywhere).
CREATE TABLE IF NOT EXISTS ${DB}.dashboards
(
    slug         String,
    title        String,
    subtitle     String        DEFAULT '',
    concurrent   Bool          DEFAULT false,
    spec_version UInt8         DEFAULT 1,
    params       Array(JSON)   DEFAULT [],
    panels       Array(JSON)   DEFAULT [],
    meta         JSON          DEFAULT '{}',
    tags         Array(String) DEFAULT [],
    owner        String        DEFAULT currentUser(),
    updated_at   DateTime      DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (owner, slug);

-- Write target. All payload columns are String — JSON-encoded text the
-- agent provides directly. The MV does the conversion to structured
-- types on the way to `dashboards`. Defaults are empty JSON literals
-- so an agent that omits an optional column still produces a valid
-- stored row after the MV parse.
CREATE TABLE IF NOT EXISTS ${DB}.dashboards_raw
(
    slug         String,
    title        String,
    subtitle     String DEFAULT '',
    concurrent   Bool   DEFAULT false,
    spec_version UInt8  DEFAULT 1,
    params       String DEFAULT '[]',
    panels       String DEFAULT '[]',
    meta         String DEFAULT '{}',
    tags         String DEFAULT '[]'
)
ENGINE = Null;

-- sanitize_json_text — strip dangerous HTML constructs from a JSON
-- text blob. Applied to `panels` in the MV before JSONExtract'ing
-- into Array(JSON). Operating on the raw String form means we run
-- two regex passes per row, not one per panel — and the function
-- name generalises if we ever extend sanitization to other JSON
-- columns.
--
-- The deletions only affect *contents* of JSON string values (HTML
-- inside a panel's `html` field, for example); structural quotes and
-- braces are preserved, so the result remains valid JSON.
--
-- Threats handled in one alternation pass (case-insensitive, single
-- line), plus a second pass that neutralises `javascript:` URLs:
--
--   Paired elements (whole element stripped):
--     <script>…</script>, <iframe>…</iframe>, <object>…</object>,
--     <svg>…</svg>, <math>…</math>, <style>…</style>, <form>…</form>
--   Self-closing / orphan / void elements (opening tag stripped):
--     script, iframe, object, svg, math, style, form, embed, link,
--     base, meta
--   Event handlers:
--     on*="…", on*='…', and (the regex gap that drove this rewrite)
--     unquoted on*=value forms like `<img onerror=alert(1)>`.
--   URL scheme:
--     javascript:
--
-- RE2 (ClickHouse's regex engine) has no backreferences, which is
-- why paired-element patterns are enumerated individually rather
-- than `<(\w+)>…</\1>`.
--
-- Pattern detail: agent-provided JSON encoders (JavaScript's
-- JSON.stringify, Python's json.dumps) leave `/` unescaped, while
-- ClickHouse's toJSONString() escapes `/` as `\/`. Close-tag and
-- self-close patterns tolerate an optional leading backslash before
-- each `/` so both forms are covered; the double-quoted event
-- handler variant likewise tolerates an optional escape on the
-- surrounding quotes.
-- Pattern (one alternation, single line — ClickHouse SQL doesn't allow
-- adjacent string-literal concatenation):
--   Paired containers: <script|iframe|object|svg|math|style|form>…</…>
--   Orphan/self-closing/void: same set plus embed/link/base/meta
--   Event handlers: on*="…", on*='…', and unquoted on*=value
-- A second pass neutralises the `javascript:` URL scheme.
CREATE OR REPLACE FUNCTION sanitize_json_text AS (s) ->
    replaceRegexpAll(
        replaceRegexpAll(
            s,
            '(?is)<script\\b[^>]*>.*?<\\\\?/script[^>]*>|<iframe\\b[^>]*>.*?<\\\\?/iframe[^>]*>|<object\\b[^>]*>.*?<\\\\?/object[^>]*>|<svg\\b[^>]*>.*?<\\\\?/svg[^>]*>|<math\\b[^>]*>.*?<\\\\?/math[^>]*>|<style\\b[^>]*>.*?<\\\\?/style[^>]*>|<form\\b[^>]*>.*?<\\\\?/form[^>]*>|<(?:script|iframe|object|svg|math|style|form|embed|link|base|meta)\\b[^>]*\\\\?/?>|\\bon[a-z]+\\s*=\\s*(?:\\\\?"[^"]*\\\\?"|''[^'']*''|[^\\s>"'']+)',
            ''),
        '(?i)javascript:', '');

-- The MV parses the agent-supplied JSON text into the read target's
-- structured types. Sanitization runs once over the panels text
-- before JSONExtract — single regex pass per row, no per-element
-- stringify/parse hops. The other JSON columns (params, meta, tags)
-- are parsed directly; they don't contain user-supplied HTML.
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.dashboards_mv TO ${DB}.dashboards AS
SELECT
    slug,
    title,
    subtitle,
    concurrent,
    spec_version,
    JSONExtract(params,                          'Array(JSON)')   AS params,
    JSONExtract(sanitize_json_text(panels),      'Array(JSON)')   AS panels,
    CAST(meta AS JSON)                                            AS meta,
    JSONExtract(tags,                            'Array(String)') AS tags,
    currentUser()                                                 AS owner,
    now()                                                         AS updated_at
FROM ${DB}.dashboards_raw;

-- Admin-curated public HTML pages, served by the SPA at /p/<name>.
-- No MATERIALIZED owner — admin-managed, not user content.
CREATE TABLE IF NOT EXISTS ${DB}.pages
(
    name       String,
    content    String,
    updated_at DateTime DEFAULT now(),
    CONSTRAINT content_size CHECK length(content) < 2 * 1024 * 1024
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY name;

-- whoami — resolves the caller's identity AND the dashboard SPA URL
-- base in one round-trip. MCP-attached agents MUST read spa_origin
-- from here rather than guessing — the MCP origin and the SPA origin
-- are different hosts.
CREATE OR REPLACE VIEW ${DB}.whoami AS
SELECT
    currentUser()                                              AS email,
    splitByChar('@', currentUser())[1]                         AS localpart,
    '${SPA_ORIGIN}'                                            AS spa_origin,
    concat('${SPA_ORIGIN}', '/v/',
           splitByChar('@', currentUser())[1], '/')            AS my_dashboards_prefix;
