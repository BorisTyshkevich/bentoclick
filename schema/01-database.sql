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
--                   Sees only the columns the writer role can set.
--                                |
--                                v
--   dashboards_mv   Materialized view — applies sanitize_panel and
--                   forwards rows to the read target.
--                                |
--                                v
--   dashboards     ReplacingMergeTree — read target for the SPA.
--                                       owner = currentUser() (MATERIALIZED),
--                                       updated_at = now() (MATERIALIZED).
--
-- Direct INSERT into `dashboards` is denied to the writer role — there
-- is no path that bypasses the MV.

CREATE DATABASE IF NOT EXISTS ${DB};

-- owner and updated_at: DEFAULT (not MATERIALIZED) so the MV's SELECT
-- can supply them explicitly. The MV is the only path with INSERT
-- grants, so column-level grants prevent forgery (no INSERT(owner)
-- is ever granted) without needing MATERIALIZED enforcement at the
-- target. Direct inserts into `dashboards` would inherit the DEFAULT.
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

CREATE TABLE IF NOT EXISTS ${DB}.dashboards_raw
(
    slug         String,
    title        String,
    subtitle     String        DEFAULT '',
    concurrent   Bool          DEFAULT false,
    spec_version UInt8         DEFAULT 1,
    params       Array(JSON)   DEFAULT [],
    panels       Array(JSON)   DEFAULT [],
    meta         JSON          DEFAULT '{}',
    tags         Array(String) DEFAULT []
)
ENGINE = Null;

-- sanitize_panel — strip dangerous HTML constructs from a panel's
-- JSON representation. Applies regex-based scrubbing on the canonical
-- JSON string and casts back to JSON. The deletions only affect
-- *contents* of string values (HTML inside the panel's `html` field);
-- structural quotes and braces are preserved, so the JSON stays valid.
--
-- Threats handled (case-insensitive, single-line):
--   <script>...</script>       — strip whole element
--   <script .../>              — strip self-closing form
--   <iframe>...</iframe>       — strip whole element
--   <iframe ...> (orphan)      — strip opening tag (defensive)
--   <object>...</object>       — strip whole element
--   <embed .../>               — strip void element
--   on*="..." / on*='...' /
--   on*=unquoted               — strip event-handler attributes
--   javascript:                — neutralize URL protocol
--
-- `type='script'` panels are passed through unchanged in v1 — viewer
-- ACL gating is deferred to v2.
-- toJSONString() escapes `/` as `\/` inside string values (per JSON
-- spec, optional but conventional). The close-tag patterns therefore
-- match an optional backslash before each `/`. The on*= patterns
-- match JSON-escaped double-quoted values (`\"...\"`) and raw
-- single-quoted values (`'...'`, which JSON leaves untouched).
CREATE OR REPLACE FUNCTION sanitize_panel AS (panel) -> CAST(
    replaceRegexpAll(
        replaceRegexpAll(
            replaceRegexpAll(
                replaceRegexpAll(
                    replaceRegexpAll(
                        replaceRegexpAll(
                            replaceRegexpAll(
                                replaceRegexpAll(
                                    replaceRegexpAll(
                                        toJSONString(panel),
                                        '(?is)<script\\b[^>]*>.*?<\\\\?/script[^>]*>', ''),
                                    '(?is)<script\\b[^>]*\\\\?/>', ''),
                                '(?is)<iframe\\b[^>]*>.*?<\\\\?/iframe[^>]*>', ''),
                            '(?is)<iframe\\b[^>]*>', ''),
                        '(?is)<object\\b[^>]*>.*?<\\\\?/object[^>]*>', ''),
                    '(?is)<embed\\b[^>]*\\\\?/?>', ''),
                '(?i)\\bon[a-z]+\\s*=\\s*\\\\"[^\\\\"]*\\\\"', ''),
            '(?i)\\bon[a-z]+\\s*=\\s*''[^'']*''', ''),
        '(?i)javascript:', '')
    AS JSON);

CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.dashboards_mv TO ${DB}.dashboards AS
SELECT
    slug,
    title,
    subtitle,
    concurrent,
    spec_version,
    params,
    arrayMap(p -> sanitize_panel(p), panels) AS panels,
    meta,
    tags,
    currentUser() AS owner,
    now()         AS updated_at
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
