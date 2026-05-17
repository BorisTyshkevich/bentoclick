"""Direct unit tests for the sanitize_json_text function.

These call the function with JSON-encoded text and assert on the
parsed result. The MV pipeline integration is tested in
test_mv_pipeline.py.
"""

from __future__ import annotations

import json


def _sanitize(ch, panel_json: str) -> dict:
    """Run sanitize_json_text on JSON text and return the parsed result.

    Wraps a single panel in `[ ... ]` so the input shape matches what
    the MV sees (panels column is an array). Each case below passes the
    panel object JSON text; we array-wrap on the way in and unwrap on
    the way out."""
    array_text = "[" + panel_json + "]"
    result = ch.query(
        "SELECT sanitize_json_text(%(p)s) AS s",
        parameters={"p": array_text},
    ).result_rows[0][0]
    return json.loads(result)[0]


def test_strips_script_block(ch):
    panel = '{"type":"html","html":"<div>ok</div><script>alert(1)</script>"}'
    got = _sanitize(ch, panel)
    assert "<script" not in got["html"]
    assert "alert" not in got["html"]
    assert "<div>ok</div>" in got["html"]


def test_strips_script_with_attributes(ch):
    panel = '{"type":"html","html":"<script type=\\"text/javascript\\" defer>evil()</script>"}'
    got = _sanitize(ch, panel)
    assert "<script" not in got["html"]
    assert "evil" not in got["html"]


def test_strips_self_closing_script(ch):
    panel = '{"type":"html","html":"<script src=\\"x.js\\"/>after"}'
    got = _sanitize(ch, panel)
    assert "<script" not in got["html"]
    assert "after" in got["html"]


def test_strips_iframe(ch):
    panel = '{"type":"html","html":"<iframe src=\\"http://evil\\"></iframe>kept"}'
    got = _sanitize(ch, panel)
    assert "<iframe" not in got["html"]
    assert "kept" in got["html"]


def test_strips_orphan_iframe_opening_tag(ch):
    panel = '{"type":"html","html":"<iframe src=\\"x\\">no close"}'
    got = _sanitize(ch, panel)
    assert "<iframe" not in got["html"]


def test_strips_object_tag(ch):
    panel = '{"type":"html","html":"<object data=\\"x.swf\\"><param/></object>after"}'
    got = _sanitize(ch, panel)
    assert "<object" not in got["html"]
    assert "after" in got["html"]


def test_strips_embed_tag(ch):
    panel = '{"type":"html","html":"<embed src=\\"x.swf\\" />after"}'
    got = _sanitize(ch, panel)
    assert "<embed" not in got["html"]
    assert "after" in got["html"]


def test_strips_double_quoted_event_handler(ch):
    panel = '{"type":"html","html":"<a href=\\"x\\" onclick=\\"alert(1)\\">x</a>"}'
    got = _sanitize(ch, panel)
    assert "onclick" not in got["html"].lower()
    assert "alert" not in got["html"]
    assert '<a href="x"' in got["html"] or "<a href=\"x\"" in got["html"]


def test_strips_single_quoted_event_handler(ch):
    panel = "{\"type\":\"html\",\"html\":\"<a onload='boom()'>x</a>\"}"
    got = _sanitize(ch, panel)
    assert "onload" not in got["html"].lower()
    assert "boom" not in got["html"]


def test_neutralizes_javascript_protocol(ch):
    panel = '{"type":"html","html":"<a href=\\"javascript:alert(1)\\">x</a>"}'
    got = _sanitize(ch, panel)
    assert "javascript:" not in got["html"].lower()


def test_preserves_benign_html(ch):
    panel = '{"type":"html","html":"<div class=\\"note\\"><b>Hello</b> <i>world</i></div>"}'
    got = _sanitize(ch, panel)
    assert "<b>Hello</b>" in got["html"]
    assert "<i>world</i>" in got["html"]
    assert 'class="note"' in got["html"] or "class=\"note\"" in got["html"]


def test_preserves_kpi_strip_panel(ch):
    panel = json.dumps({
        "type": "kpi-strip",
        "id": "k",
        "query": "SELECT count() FROM t",
        "tiles": [{"key": "count", "label": "Rows", "format": "num"}],
    })
    got = _sanitize(ch, panel)
    # Non-html panel comes through unchanged.
    assert got["type"] == "kpi-strip"
    assert got["query"] == "SELECT count() FROM t"
    assert got["tiles"][0]["label"] == "Rows"


def test_preserves_table_with_html_looking_query(ch):
    # SQL queries can mention things that look like HTML markers; they
    # should NOT be stripped — sanitization is targeted at user-visible
    # markup, not arbitrary text. The current implementation is
    # conservative and may rewrite tokens; this test pins the actual
    # observed behavior so changes are deliberate.
    panel = json.dumps({
        "type": "table",
        "id": "t",
        "query": "SELECT formatRow('CSV', 'a', 'b')",
        "columns": [{"key": "x", "label": "X"}],
    })
    got = _sanitize(ch, panel)
    assert got["type"] == "table"
    assert "formatRow" in got["query"]


def test_preserves_script_panel_type(ch):
    # v1 trust model: type='script' panels pass through. The sanitizer
    # may still touch attribute-like substrings (on* / javascript:) in
    # the inline `html` shell, but `type` and `script` body remain.
    panel = json.dumps({
        "type": "script",
        "id": "s",
        "html": "<div id='drill'>click me</div>",
        "script": "await DASH.spec.ready; console.log('ok');",
    })
    got = _sanitize(ch, panel)
    assert got["type"] == "script"
    assert "DASH.spec.ready" in got["script"]
    assert "console.log" in got["script"]


def test_strips_uppercase_script_tag(ch):
    panel = '{"type":"html","html":"<SCRIPT>x</SCRIPT>kept"}'
    got = _sanitize(ch, panel)
    assert "SCRIPT" not in got["html"].upper().replace("KEPT", "")  # nothing left containing SCRIPT
    assert "kept" in got["html"]


def test_strips_multiline_script(ch):
    panel = '{"type":"html","html":"a<script>\\nline1\\nline2\\n</script>b"}'
    got = _sanitize(ch, panel)
    assert "<script" not in got["html"]
    assert "line1" not in got["html"]
    assert "a" in got["html"] and "b" in got["html"]
