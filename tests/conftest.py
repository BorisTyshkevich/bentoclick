"""Shared pytest fixtures for bentoclick schema tests.

Each test gets a fresh per-test database by way of the ``ch`` fixture
below. The CH container is expected to be running on
``localhost:CH_HTTP_PORT`` (defaults to 18123) — ``make test-schema``
brings it up via docker-compose before invoking pytest.
"""

from __future__ import annotations

import os
import pathlib
import string
import uuid

import clickhouse_connect
import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
SCHEMA_DIR = REPO_ROOT / "schema"

CH_HOST = os.environ.get("CH_HOST", "localhost")
CH_HTTP_PORT = int(os.environ.get("CH_HTTP_PORT", "18123"))
CH_USER = os.environ.get("CH_USER", "default")
CH_PASSWORD = os.environ.get("CH_PASSWORD", "")


def _connect(database: str | None = None):
    return clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_HTTP_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
        database=database or "default",
    )


def _apply_schema(client, db_name: str) -> None:
    """Apply every ``.sql`` file under ``schema/`` with ``${DB}`` and
    ``${SPA_ORIGIN}`` substituted. Statements are split on ``;\\n``
    and applied one by one — clickhouse-connect rejects multi-statement
    bodies otherwise."""
    spa_origin = os.environ.get("SPA_ORIGIN", "http://localhost:18123")
    for sql_path in sorted(SCHEMA_DIR.glob("*.sql")):
        raw = sql_path.read_text()
        text = string.Template(raw).safe_substitute(
            DB=db_name,
            SPA_ORIGIN=spa_origin,
        )
        for stmt in _split_statements(text):
            client.command(stmt)


def _split_statements(text: str) -> list[str]:
    """Naive ``;``-on-newline splitter. Good enough for our DDL —
    none of our schema files embed ``;`` inside string literals."""
    out: list[str] = []
    buf: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buf.append(line)
        if stripped.endswith(";"):
            stmt = "\n".join(buf).rstrip().rstrip(";").strip()
            if stmt:
                out.append(stmt)
            buf = []
    tail = "\n".join(buf).strip().rstrip(";").strip()
    if tail:
        out.append(tail)
    return out


@pytest.fixture
def ch():
    """Yield a clickhouse-connect client pointing at a fresh ephemeral
    database. Schema is applied; database is dropped on teardown."""
    db_name = f"test_{uuid.uuid4().hex[:12]}"
    admin = _connect()
    admin.command(f"CREATE DATABASE {db_name}")
    try:
        _apply_schema(admin, db_name)
        client = _connect(database=db_name)
        client.db_name = db_name  # type: ignore[attr-defined]
        try:
            yield client
        finally:
            client.close()
    finally:
        admin.command(f"DROP DATABASE IF EXISTS {db_name} SYNC")
        admin.close()


@pytest.fixture
def ch_admin():
    """Yield an admin client at the ``default`` database without
    creating a fresh per-test DB. Use only for tests that need raw
    admin access (e.g. inspecting system tables)."""
    client = _connect()
    try:
        yield client
    finally:
        client.close()
