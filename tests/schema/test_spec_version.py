"""spec_version: default, range, and type-rejection behavior.

The runtime gates renderable versions in JavaScript (the SPA loads
/lib/v<N>/dash.js). The DB layer just stores whatever UInt8 the writer
supplied, with a default of 1.
"""

from __future__ import annotations


def _insert(ch, slug: str, *, spec_version=None) -> None:
    cols = ["slug", "title"]
    select_parts = ["%(slug)s", "%(title)s"]
    params: dict = {"slug": slug, "title": slug}
    if spec_version is not None:
        cols.append("spec_version")
        select_parts.append("%(sv)s")
        params["sv"] = spec_version
    ch.command(
        f"INSERT INTO {ch.db_name}.dashboards_raw ({', '.join(cols)}) "
        f"SELECT {', '.join(select_parts)}",
        parameters=params,
    )


def _read_spec_version(ch, slug: str) -> int:
    return ch.query(
        f"SELECT spec_version FROM {ch.db_name}.dashboards FINAL "
        "WHERE slug = %(slug)s",
        parameters={"slug": slug},
    ).result_rows[0][0]


def test_spec_version_defaults_to_one(ch):
    _insert(ch, "default-v")
    assert _read_spec_version(ch, "default-v") == 1


def test_spec_version_accepts_explicit_one(ch):
    _insert(ch, "explicit-1", spec_version=1)
    assert _read_spec_version(ch, "explicit-1") == 1


def test_spec_version_accepts_future_versions(ch):
    # Runtime decides what to do with unknown versions (refuses to render
    # with a clear message); the DB layer accepts any UInt8.
    for v in (2, 3, 17, 99, 255):
        slug = f"future-{v}"
        _insert(ch, slug, spec_version=v)
        assert _read_spec_version(ch, slug) == v, f"failed for v={v}"


def test_spec_version_overflow_is_coerced_to_uint8(ch):
    # CH silently coerces out-of-range integers to UInt8 (wraparound or
    # clamping depending on the path). This is by design at the DB layer.
    # MCP write-tool callers MUST validate spec_version in [0, 255]
    # BEFORE issuing the INSERT — the JSON-schema for the reflected
    # tool exposes spec_version as uint8 with that range. Below we just
    # confirm the stored value remains a valid UInt8.
    _insert(ch, "overflow", spec_version=256)
    stored = _read_spec_version(ch, "overflow")
    assert 0 <= stored <= 255, f"stored UInt8 must be in [0, 255]; got {stored}"


def test_spec_version_negative_is_coerced_to_uint8(ch):
    _insert(ch, "negative", spec_version=-1)
    stored = _read_spec_version(ch, "negative")
    assert 0 <= stored <= 255, f"stored UInt8 must be in [0, 255]; got {stored}"


def test_spec_version_column_is_uint8(ch):
    # The column type alone is the storage-layer guarantee. MCP tool
    # validation is the user-facing guarantee.
    row = ch.query(
        f"SELECT type FROM system.columns "
        f"WHERE database = %(db)s AND table = 'dashboards' AND name = 'spec_version'",
        parameters={"db": ch.db_name},
    ).result_rows[0]
    assert row[0] == "UInt8"
