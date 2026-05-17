"""Security regression: the only path from any role to `dashboards` is
through `dashboards_raw` + the SECURITY DEFINER MV. A direct INSERT
into `dashboards` must fail for any role other than the definer.

The defense is layered:
  1. Writer role has no INSERT grant on dashboards (column-level grants
     on `_raw` only).
  2. Explicit REVOKE INSERT/ALTER/DELETE on dashboards from both reader
     and writer roles in 02-roles.sql.
  3. SQL SECURITY DEFINER MV runs as `${DB}_definer`, which is the ONLY
     principal with INSERT on dashboards.

This test exercises layer (1) + (2) by creating a writer user, granting
it the writer role, and asserting that direct INSERTs are rejected.
"""

from __future__ import annotations

import uuid

import clickhouse_connect
import pytest

from conftest import CH_HOST, CH_HTTP_PORT, CH_PASSWORD, CH_USER


def _connect_as(user: str, password: str = "", database: str | None = None):
    return clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_HTTP_PORT,
        username=user,
        password=password,
        database=database or "default",
    )


@pytest.fixture
def writer_user(ch, ch_admin):
    """Create an ephemeral user with the writer role granted, yield a
    clickhouse-connect client logged in as that user. Tear down on
    exit. Lives at module scope alongside the existing `ch` fixture,
    which provides the per-test schema."""
    db_name = ch.db_name
    user = f"test_writer_{uuid.uuid4().hex[:8]}"
    pw = "x"
    ch_admin.command(
        f"CREATE USER {user} IDENTIFIED WITH plaintext_password BY '{pw}'"
    )
    ch_admin.command(f"GRANT {db_name}_writer_role TO {user}")
    ch_admin.command(f"ALTER USER {user} DEFAULT ROLE {db_name}_writer_role")
    try:
        client = _connect_as(user, pw, database=db_name)
        client.user_name = user  # type: ignore[attr-defined]
        try:
            yield client
        finally:
            client.close()
    finally:
        ch_admin.command(f"DROP USER IF EXISTS {user}")


def test_writer_cannot_direct_insert_into_dashboards(ch, writer_user):
    """Layer 1+2 defense: writer role explicitly REVOKED from INSERT
    on dashboards. Direct INSERT must fail with a privilege error."""
    with pytest.raises(Exception) as exc:
        writer_user.command(
            f"INSERT INTO {ch.db_name}.dashboards "
            "(slug, title, owner) SELECT 'forged', 'F', 'victim@example.com'"
        )
    msg = str(exc.value)
    # CH error code 497 = NOT_ENOUGH_PRIVILEGES; message text varies
    # across versions but should reference privilege or grant.
    assert (
        "497" in msg
        or "NOT_ENOUGH_PRIVILEGES" in msg
        or "ACCESS_DENIED" in msg
        or "privilege" in msg.lower()
        or "not granted" in msg.lower()
    ), f"expected privilege error, got: {msg}"


def test_writer_can_insert_into_raw_and_mv_propagates(ch, writer_user):
    """Same writer can INSERT into _raw; SECURITY DEFINER MV
    propagates the row to `dashboards` with `owner = currentUser()`
    set to the writer's username (CH's currentUser() returns the
    session user even under DEFINER)."""
    writer_user.command(
        f"INSERT INTO {ch.db_name}.dashboards_raw "
        "(slug, title, params, panels, meta, tags) "
        "SELECT 'mv-probe', 'MV probe', '[]', '[]', '{}', '[]'"
    )
    rows = ch.query(
        f"SELECT owner FROM {ch.db_name}.dashboards FINAL WHERE slug = 'mv-probe'"
    ).result_rows
    assert rows, "row should land in dashboards via the SECURITY DEFINER MV"
    owner = rows[0][0]
    # owner should be the writer's username (currentUser() in CH
    # returns the session user even under DEFINER, empirically), not
    # the definer (which would be `${db_name}_definer`).
    assert owner == writer_user.user_name, (
        f"owner should be currentUser() = {writer_user.user_name}, "
        f"NOT the SECURITY DEFINER user; got {owner!r}"
    )
    assert owner != f"{ch.db_name}_definer", (
        "owner must never be the SECURITY DEFINER user"
    )
