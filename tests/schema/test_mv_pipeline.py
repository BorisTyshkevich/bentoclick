"""End-to-end MV pipeline tests.

These insert into ``dashboards_raw`` and inspect what lands in
``dashboards``, confirming the full chain: writer's INSERT → MV
sanitization → ReplacingMergeTree storage. The granular per-pattern
sanitizer behavior lives in ``test_sanitize_panel.py``; here we verify
the pipeline wires up correctly and applies sanitization to every
panel in the array.
"""

from __future__ import annotations

import json


def _insert(ch, slug: str, panels: list[dict]) -> None:
    """Insert one dashboard row through the SELECT path (CH 26.3
    currentUser()-quirk-safe — see test_dashboards_table.py).

    Array(JSON) doesn't accept CAST from a raw JSON-array string;
    use JSONExtract(s, 'Array(JSON)') instead, which parses the array
    and casts each element."""
    panels_json = json.dumps(panels)
    ch.command(
        f"INSERT INTO {ch.db_name}.dashboards_raw "
        "(slug, title, panels) "
        "SELECT %(slug)s, %(title)s, JSONExtract(%(panels)s, 'Array(JSON)')",
        parameters={"slug": slug, "title": slug.title(), "panels": panels_json},
    )


def _fetch_panels(ch, slug: str) -> list[dict]:
    rows = ch.query(
        f"SELECT toJSONString(panels) FROM {ch.db_name}.dashboards FINAL "
        "WHERE slug = %(slug)s",
        parameters={"slug": slug},
    ).result_rows
    assert rows, f"no row for slug={slug}"
    return json.loads(rows[0][0])


def test_html_panel_script_stripped_via_mv(ch):
    _insert(ch, "xss1", [
        {"type": "html", "html": "<div>hi</div><script>alert('x')</script>"},
    ])
    panels = _fetch_panels(ch, "xss1")
    assert len(panels) == 1
    assert "<script" not in panels[0]["html"]
    assert "alert" not in panels[0]["html"]
    assert "hi" in panels[0]["html"]


def test_html_panel_event_handler_stripped_via_mv(ch):
    _insert(ch, "xss2", [
        {"type": "html", "html": "<a href=\"x\" onclick=\"go()\">click</a>"},
    ])
    panels = _fetch_panels(ch, "xss2")
    assert "onclick" not in panels[0]["html"].lower()
    assert "go()" not in panels[0]["html"]


def test_html_panel_javascript_url_stripped_via_mv(ch):
    _insert(ch, "xss3", [
        {"type": "html", "html": "<a href=\"javascript:boom()\">x</a>"},
    ])
    panels = _fetch_panels(ch, "xss3")
    assert "javascript:" not in panels[0]["html"].lower()


def test_each_panel_sanitized_independently(ch):
    _insert(ch, "multi", [
        {"type": "kpi-strip", "id": "k", "query": "SELECT 1 AS one",
         "tiles": [{"key": "one", "label": "One"}]},
        {"type": "html", "html": "<script>evil</script>safe"},
        {"type": "markdown", "text": "## Heading"},
    ])
    panels = _fetch_panels(ch, "multi")
    assert len(panels) == 3
    assert panels[0]["type"] == "kpi-strip"
    assert panels[0]["query"] == "SELECT 1 AS one"
    assert "<script" not in panels[1]["html"]
    assert "safe" in panels[1]["html"]
    assert panels[2]["text"] == "## Heading"


def test_empty_panels_array_round_trips(ch):
    _insert(ch, "empty", [])
    panels = _fetch_panels(ch, "empty")
    assert panels == []


def test_script_panel_passes_through_v1(ch):
    """In the v1 open-to-all-viewers trust model, type='script' is not
    blocked by the MV. The script body and html shell pass through.
    Future spec_version: ACL-gated."""
    _insert(ch, "scripty", [
        {
            "type": "script", "id": "s",
            "html": "<div id='drill'>click</div>",
            "script": "await DASH.spec.ready; console.log('ok');",
        },
    ])
    panels = _fetch_panels(ch, "scripty")
    assert len(panels) == 1
    p = panels[0]
    assert p["type"] == "script"
    assert "DASH.spec.ready" in p["script"]
    assert "console.log('ok')" in p["script"]


def test_replacing_merge_tree_dedups_on_owner_slug(ch):
    """Repeated inserts for the same (owner, slug) collapse to the
    latest row (by updated_at) after FINAL. Confirms ReplacingMergeTree
    semantics through the MV pipeline."""
    _insert(ch, "dup", [{"type": "markdown", "text": "v1"}])
    _insert(ch, "dup", [{"type": "markdown", "text": "v2"}])
    panels = _fetch_panels(ch, "dup")
    assert len(panels) == 1
    assert panels[0]["text"] == "v2"


def test_owner_set_by_mv_not_writer(ch):
    """The MV computes owner = currentUser(); the writer never sets it."""
    _insert(ch, "ownerchk", [{"type": "markdown", "text": "x"}])
    row = ch.query(
        f"SELECT owner FROM {ch.db_name}.dashboards FINAL WHERE slug = 'ownerchk'"
    ).result_rows[0]
    assert row[0] == "default"
