-- bentoclick — reader and writer roles for the dashboard database.
--
-- The writer role gets column-level INSERT on `dashboards_raw` only.
-- There is no INSERT grant on `dashboards` — the only way a row lands
-- there is through `dashboards_mv`, which runs sanitization.
--
-- Reader role gets SELECT on the whole database so the SPA can read
-- the read target, the whoami view, and any auxiliary tables.

CREATE ROLE IF NOT EXISTS ${DB}_reader_role;
GRANT SELECT ON ${DB}.* TO ${DB}_reader_role;

CREATE ROLE IF NOT EXISTS ${DB}_writer_role;
GRANT ${DB}_reader_role TO ${DB}_writer_role;
GRANT INSERT(slug, title, subtitle, concurrent, spec_version, params, panels, meta, tags)
   ON ${DB}.dashboards_raw TO ${DB}_writer_role;
