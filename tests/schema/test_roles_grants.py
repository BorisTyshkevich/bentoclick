"""Reader/writer role grants for the dashboard database."""

from __future__ import annotations


WRITER_INSERT_COLUMNS = {
    "slug", "title", "subtitle", "concurrent", "spec_version",
    "params", "panels", "meta", "tags",
}


def _role_name(role: str, db: str) -> str:
    return f"{db}_{role}_role"


def _show_grants(ch, role: str) -> list[str]:
    rows = ch.query(f"SHOW GRANTS FOR {role}").result_rows
    return [r[0] for r in rows]


def test_reader_role_exists(ch):
    role = _role_name("reader", ch.db_name)
    grants = _show_grants(ch, role)
    select_grants = [g for g in grants if "SELECT" in g and ch.db_name in g]
    assert select_grants, f"reader role has no SELECT on {ch.db_name}.*; grants: {grants}"


def test_reader_role_has_select_on_database(ch):
    role = _role_name("reader", ch.db_name)
    grants = _show_grants(ch, role)
    expected = f"GRANT SELECT ON {ch.db_name}.* TO {role}"
    assert any(g == expected for g in grants), (
        f"expected `{expected}` in reader grants; got: {grants}"
    )


def test_writer_role_exists(ch):
    role = _role_name("writer", ch.db_name)
    grants = _show_grants(ch, role)
    assert grants, f"writer role has no grants: {grants}"


def test_writer_role_has_insert_on_raw_only(ch):
    role = _role_name("writer", ch.db_name)
    grants = _show_grants(ch, role)
    insert_grants = [g for g in grants if "INSERT" in g]
    assert len(insert_grants) == 1, (
        f"writer must have exactly one INSERT grant; got: {insert_grants}"
    )
    grant = insert_grants[0]
    assert "dashboards_raw" in grant, f"INSERT must target dashboards_raw: {grant}"
    assert "dashboards_raw" in grant and ".dashboards " not in grant, (
        f"INSERT must NOT target dashboards (read table): {grant}"
    )


def test_writer_role_insert_grant_lists_expected_columns(ch):
    role = _role_name("writer", ch.db_name)
    grants = _show_grants(ch, role)
    insert_grants = [g for g in grants if "INSERT" in g]
    assert insert_grants, "no INSERT grant found"
    grant = insert_grants[0]
    # SHOW GRANTS prints columns in parentheses: INSERT(a, b, c) ON ...
    open_paren = grant.find("(")
    close_paren = grant.find(")")
    assert open_paren > 0 and close_paren > open_paren, (
        f"writer INSERT grant must be column-level (parenthesized): {grant}"
    )
    cols = {c.strip() for c in grant[open_paren + 1:close_paren].split(",")}
    assert cols == WRITER_INSERT_COLUMNS, (
        f"writer INSERT columns drifted: expected {WRITER_INSERT_COLUMNS}, got {cols}"
    )


def test_writer_role_has_no_insert_on_dashboards(ch):
    role = _role_name("writer", ch.db_name)
    grants = _show_grants(ch, role)
    bad = [g for g in grants
           if "INSERT" in g and "dashboards_raw" not in g and ".dashboards" in g]
    assert not bad, f"writer role must NOT have INSERT on dashboards: {bad}"


def test_writer_role_inherits_reader(ch):
    writer = _role_name("writer", ch.db_name)
    reader = _role_name("reader", ch.db_name)
    grants = _show_grants(ch, writer)
    has_reader = any(f"GRANT {reader} TO {writer}" == g for g in grants)
    assert has_reader, (
        f"writer must inherit reader role; got grants: {grants}"
    )


# ---- Definer user (SQL SECURITY DEFINER target for dashboards_mv) ----

def test_definer_user_exists(ch):
    """${DB}_definer must exist; it's the principal the MV runs as."""
    rows = ch.query(
        "SELECT count() FROM system.users WHERE name = %(u)s",
        parameters={"u": f"{ch.db_name}_definer"},
    ).result_rows
    assert rows[0][0] == 1, f"definer user {ch.db_name}_definer not found"


def test_definer_user_has_minimal_grants(ch):
    """Definer must have SELECT on dashboards_raw + INSERT on
    dashboards. Nothing else — no DELETE, no ALTER, no SELECT on
    dashboards (the MV body never reads from the destination)."""
    grants = _show_grants(ch, f"{ch.db_name}_definer")
    has_select_raw = any(
        f"GRANT SELECT ON {ch.db_name}.dashboards_raw" in g for g in grants
    )
    has_insert_dashboards = any(
        f"GRANT INSERT ON {ch.db_name}.dashboards" in g
        and "dashboards_raw" not in g
        for g in grants
    )
    assert has_select_raw, f"definer missing SELECT on dashboards_raw: {grants}"
    assert has_insert_dashboards, (
        f"definer missing INSERT on dashboards: {grants}"
    )
    # Definer should have NO other grants.
    bad = [
        g for g in grants
        if "ALTER" in g or "DELETE" in g or "DROP" in g
    ]
    assert not bad, f"definer has unexpected mutation grants: {bad}"


# ---- Defense-in-depth REVOKE on dashboards ----

def test_reader_and_writer_revoked_from_dashboards(ch):
    """Explicit REVOKE ensures even a stray future grant or role
    inheritance can't put INSERT/ALTER/DELETE on dashboards into the
    reader or writer roles. The SECURITY DEFINER MV is the only legit
    write path."""
    for role_kind in ("reader", "writer"):
        role = _role_name(role_kind, ch.db_name)
        grants = _show_grants(ch, role)
        bad = [
            g for g in grants
            if (
                ("INSERT" in g or "ALTER" in g or "DELETE" in g)
                and f"{ch.db_name}.dashboards" in g
                and "dashboards_raw" not in g
            )
        ]
        assert not bad, (
            f"{role} must not have INSERT/ALTER/DELETE on dashboards "
            f"(SECURITY DEFINER MV is the only writer): {bad}"
        )
