-- bentoclick — reader and writer roles for the dashboard database.
--
-- The writer role gets column-level INSERT on `dashboards_raw` only.
-- There is no INSERT grant on `dashboards` — the only way a row lands
-- there is through `dashboards_mv`, which runs as ${DB}_definer
-- (SQL SECURITY DEFINER, see 01-database.sql).
--
-- Reader role gets SELECT on the whole database so the SPA can read
-- the read target, the dashboards_prefix view, and any auxiliary tables.
--
-- The trailing REVOKE is defense in depth: even if a future role
-- somewhere on the cluster (an operator account, a `<token>`
-- user_directory `common_roles` setting, a stray ad-hoc grant)
-- picks up INSERT/ALTER/DELETE on `${DB}.dashboards`, this REVOKE
-- removes it from both the reader and writer roles. The definer's
-- grant survives because it's granted to the user directly, not
-- via a role.

CREATE ROLE IF NOT EXISTS ${DB}_reader_role
  ON CLUSTER '{cluster}';
GRANT SELECT ON ${DB}.* TO ${DB}_reader_role
  ON CLUSTER '{cluster}';

CREATE ROLE IF NOT EXISTS ${DB}_writer_role
  ON CLUSTER '{cluster}';
GRANT ${DB}_reader_role TO ${DB}_writer_role
  ON CLUSTER '{cluster}';
GRANT INSERT(slug, title, subtitle, concurrent, spec_version, params, panels, meta, tags)
   ON ${DB}.dashboards_raw TO ${DB}_writer_role
  ON CLUSTER '{cluster}';

-- Defense in depth: belt-and-suspenders against future grant drift.
-- The writer role's column-level INSERT on _raw is unaffected (that
-- grant targets `dashboards_raw`, not `dashboards`).
REVOKE INSERT, ALTER, DELETE ON ${DB}.dashboards
  FROM ${DB}_reader_role, ${DB}_writer_role
  ON CLUSTER '{cluster}';
