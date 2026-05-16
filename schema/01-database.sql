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

-- Identity MV for v1 step 3 — sanitize_panel is added in step 4.
-- Once sanitize_panel exists this becomes:
--   panels => arrayMap(p -> ${DB}.sanitize_panel(p), panels)
CREATE MATERIALIZED VIEW IF NOT EXISTS ${DB}.dashboards_mv TO ${DB}.dashboards AS
SELECT
    slug,
    title,
    subtitle,
    concurrent,
    spec_version,
    params,
    panels,
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
