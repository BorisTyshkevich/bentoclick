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
