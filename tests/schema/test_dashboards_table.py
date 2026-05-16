"""Schema shape tests for ${DB}.dashboards and ${DB}.dashboards_raw."""

from __future__ import annotations


EXPECTED_DASHBOARDS_COLUMNS = {
    # name -> (type, default_kind)
    "slug":         ("String",        ""),
    "title":        ("String",        ""),
    "subtitle":     ("String",        "DEFAULT"),
    "concurrent":   ("Bool",          "DEFAULT"),
    "spec_version": ("UInt8",         "DEFAULT"),
    "params":       ("Array(JSON)",   "DEFAULT"),
    "panels":       ("Array(JSON)",   "DEFAULT"),
    "meta":         ("JSON",          "DEFAULT"),
    "tags":         ("Array(String)", "DEFAULT"),
    "owner":        ("String",        "DEFAULT"),
    "updated_at":   ("DateTime",      "DEFAULT"),
}

# Writer-settable columns: dashboards minus owner and updated_at, which
# are supplied by the MV (currentUser() / now()).
WRITER_SETTABLE = {"slug", "title", "subtitle", "concurrent", "spec_version",
                   "params", "panels", "meta", "tags"}
EXPECTED_RAW_COLUMNS = {k: v for k, v in EXPECTED_DASHBOARDS_COLUMNS.items()
                       if k in WRITER_SETTABLE}


def _columns(ch, table: str) -> dict[str, tuple[str, str]]:
    rows = ch.query(
        "SELECT name, type, default_kind FROM system.columns "
        "WHERE database = %(db)s AND table = %(t)s",
        parameters={"db": ch.db_name, "t": table},
    ).result_rows
    return {name: (type_, dk) for name, type_, dk in rows}


def test_dashboards_columns_match_spec(ch):
    got = _columns(ch, "dashboards")
    assert got == EXPECTED_DASHBOARDS_COLUMNS, (
        f"dashboards columns drifted:\n  expected: {EXPECTED_DASHBOARDS_COLUMNS}\n  got:      {got}"
    )


def test_dashboards_raw_columns_match_spec(ch):
    got = _columns(ch, "dashboards_raw")
    assert got == EXPECTED_RAW_COLUMNS, (
        f"dashboards_raw columns drifted:\n  expected: {EXPECTED_RAW_COLUMNS}\n  got:      {got}"
    )


def test_dashboards_raw_has_no_owner_or_updated_at(ch):
    got = _columns(ch, "dashboards_raw")
    forbidden = set(got.keys()) & {"owner", "updated_at"}
    assert not forbidden, (
        f"dashboards_raw must not expose owner/updated_at; found: {forbidden}"
    )


def test_dashboards_engine_is_replacing_merge_tree(ch):
    row = ch.query(
        "SELECT engine, engine_full FROM system.tables "
        "WHERE database = %(db)s AND name = 'dashboards'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    engine, engine_full = row
    assert engine == "ReplacingMergeTree", f"engine: {engine}"
    assert "updated_at" in engine_full, (
        f"engine_full must reference updated_at as the version column: {engine_full}"
    )


def test_dashboards_raw_engine_is_null(ch):
    row = ch.query(
        "SELECT engine FROM system.tables "
        "WHERE database = %(db)s AND name = 'dashboards_raw'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    assert row[0] == "Null", f"engine: {row[0]}"


def test_dashboards_sorting_key_is_owner_slug(ch):
    row = ch.query(
        "SELECT sorting_key FROM system.tables "
        "WHERE database = %(db)s AND name = 'dashboards'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    sorting_key = row[0].replace(" ", "")
    assert sorting_key == "owner,slug", f"sorting_key: {row[0]}"


def test_dashboards_mv_wires_raw_to_dashboards(ch):
    row = ch.query(
        "SELECT engine, as_select FROM system.tables "
        "WHERE database = %(db)s AND name = 'dashboards_mv'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    engine, as_select = row
    assert engine == "MaterializedView", f"engine: {engine}"
    assert "dashboards_raw" in as_select, (
        f"MV must SELECT FROM dashboards_raw, got: {as_select}"
    )

    # TO-target: system.tables stores it on the inner .inner_id_xxx table or
    # via `target_table` in CH 24+. Verify by checking that an insert into
    # dashboards_raw ends up in dashboards (separate test below).


def test_insert_into_raw_propagates_to_dashboards(ch):
    # Sanity: insert into dashboards_raw, see a row appear in dashboards
    # with owner = currentUser() and a non-zero updated_at.
    #
    # NOTE: uses INSERT ... SELECT form intentionally. ClickHouse 26.3
    # has a bug where currentUser() inside any expression evaluated
    # after an INSERT ... VALUES (including DEFAULTs and MV SELECT
    # bodies) returns '' instead of the actual user. The MCP reflected
    # write tool emits INSERT statements that flow through the SELECT
    # path so this is the realistic call shape. See docs/SANITIZATION.md
    # for the longer story.
    ch.command(
        f"INSERT INTO {ch.db_name}.dashboards_raw "
        "(slug, title, subtitle, concurrent, spec_version, params, panels, meta, tags) "
        "SELECT 'smoke', 'Smoke', 'hi', false, 1, [], [], '{}', []"
    )
    rows = ch.query(
        f"SELECT slug, title, owner, spec_version, "
        f"       toUnixTimestamp(updated_at) > 0 AS has_ts "
        f"FROM {ch.db_name}.dashboards FINAL WHERE slug = 'smoke'"
    ).result_rows
    assert len(rows) == 1, f"expected 1 row in dashboards after raw insert, got: {rows}"
    slug, title, owner, spec_version, has_ts = rows[0]
    assert (slug, title) == ("smoke", "Smoke")
    assert owner == "default", f"owner should be currentUser() = default; got {owner!r}"
    assert spec_version == 1
    assert has_ts == 1


def test_insert_values_form_owner_quirk(ch):
    """Regression check on the CH 26.3 quirk: INSERT...VALUES leaves
    owner empty. If this test starts failing because owner = 'default',
    that means the upstream bug is fixed and we can drop the SELECT-form
    requirement from docs/SANITIZATION.md."""
    ch.command(
        f"INSERT INTO {ch.db_name}.dashboards_raw "
        "(slug, title) VALUES ('quirk', 'Q')"
    )
    rows = ch.query(
        f"SELECT owner FROM {ch.db_name}.dashboards FINAL WHERE slug = 'quirk'"
    ).result_rows
    assert rows, "row should still land via the MV"
    if rows[0][0] != "":
        import pytest
        pytest.xfail(
            "CH currentUser()-in-VALUES quirk appears fixed: "
            f"owner = {rows[0][0]!r}. Drop the SELECT-form requirement."
        )
    assert rows[0][0] == "", (
        "expected the documented CH 26.3 quirk to leave owner empty on "
        "INSERT...VALUES; got {rows[0][0]!r}"
    )


def test_pages_table_exists(ch):
    row = ch.query(
        "SELECT engine, sorting_key FROM system.tables "
        "WHERE database = %(db)s AND name = 'pages'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    assert row[0] == "ReplacingMergeTree"
    assert row[1] == "name"


def test_whoami_view_returns_expected_fields(ch):
    rows = ch.query(
        f"SELECT email, localpart, spa_origin, my_dashboards_prefix "
        f"FROM {ch.db_name}.whoami"
    ).result_rows
    assert len(rows) == 1
    email, localpart, spa_origin, prefix = rows[0]
    assert email == "default"
    assert localpart == "default"
    assert spa_origin.startswith("http"), f"spa_origin: {spa_origin}"
    assert prefix == f"{spa_origin}/v/{localpart}/"
