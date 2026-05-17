// bentoclick runtime v1 — dashboard spec renderer.
//
// Loaded by the SPA shell as `<script type="module" src="/lib/v1/dash.js">`.
// At the bottom this assigns `window.DASH = api` for compatibility with
// `script` panels that reference `DASH.spec.*`. Named exports support
// unit testing in happy-dom (see tests/runtime/unit/).
//
// Source: adapted from acm/mcp/dash/assets/dash-runtime.js (the pre-v1
// blob runtime). Differences:
//  - ES module structure (was an IIFE on `window`).
//  - Hybrid mode (`#dash-hybrid`) is gone — HTML lives in `html` and
//    `script` panel types instead.
//  - Two new panel types: `html` (static markup + optional templated
//    query) and `script` (JS escape hatch with the full DASH.spec.*
//    API and sandboxed iframe).

// ============================================================
// Formatters
// ============================================================
export const fmt = {
  cost(v) {
    const n = Number(v) || 0;
    return n >= 10 ? '$' + n.toFixed(2) : '$' + n.toFixed(3);
  },
  num(v) {
    return (Number(v) || 0).toLocaleString();
  },
  pct(v, digits) {
    return ((Number(v) || 0) * 100).toFixed(digits == null ? 1 : digits) + '%';
  },
  esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },
  raw(s) { return fmt.esc(s); },
  date(v) { return String(v == null ? '' : v).slice(0, 10); },
  day(v)  { return fmt.date(v); },
  shortEmail(e) {
    if (!e) return '(unknown)';
    return String(e).split('@')[0];
  },
  // hhmm (UInt16, e.g. 1305) → 'hh:mm'. Null/undefined/'' → ''.
  time(v) {
    if (v == null || v === '') return '';
    const s = String(v).padStart(4, '0');
    return s.slice(0, s.length - 2) + ':' + s.slice(-2);
  },
  // minutes (number) → 'Xh YYm'. Negative/null/undefined → ''.
  duration(v) {
    if (v == null || v === '') return '';
    const n = Number(v);
    if (!isFinite(n) || n < 0) return '';
    const h = Math.floor(n / 60);
    const m = Math.round(n % 60);
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  },
  // bytes (number) → '123 B' / '12.3 KB' / '4.5 MB'.
  bytes(v) {
    const n = Number(v) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  },
};

// Look up a fmt helper by dotted path ("fmt.shortEmail" → fmt.shortEmail).
// Returns null if the path doesn't resolve to a function.
export function resolveFormatFn(api, dottedPath) {
  if (!dottedPath || typeof dottedPath !== 'string') return null;
  const parts = dottedPath.split('.');
  let ref = api;
  for (let i = 0; i < parts.length && ref; i++) ref = ref[parts[i]];
  return typeof ref === 'function' ? ref : null;
}

export function applyFormat(api, name, v, fnOverride) {
  const fn = resolveFormatFn(api, fnOverride);
  if (fn) return fn(v);
  const f = fmt[name];
  if (typeof f === 'function') return f(v);
  return fmt.esc(v);
}

// ============================================================
// Param substitution — {{name}} → strictly validated per-type.
// ============================================================
export function makeInterpolator(paramDefs, currentValues) {
  const defs = {};
  (paramDefs || []).forEach((p) => { defs[p.name] = p; });
  return function interpolate(template) {
    return String(template).replace(
      /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (_m, name) => {
        const def = defs[name];
        if (!def) throw new Error("Unknown param: '" + name + "'");
        const v = currentValues[name];
        switch (def.type) {
          case 'int': {
            const n = Number(v);
            if (!isFinite(n) || Math.floor(n) !== n)
              throw new Error('Bad ' + name + ' (not an integer): ' + v);
            if (def.min != null && n < def.min)
              throw new Error('Bad ' + name + ' (' + n + ' < ' + def.min + ')');
            if (def.max != null && n > def.max)
              throw new Error('Bad ' + name + ' (' + n + ' > ' + def.max + ')');
            return String(n);
          }
          case 'enum': {
            const ok = (def.options || []).indexOf(String(v)) >= 0;
            if (!ok) throw new Error('Bad ' + name + ' (not in options): ' + v);
            return "'" + String(v).replace(/'/g, "''") + "'";
          }
          case 'date': {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
              throw new Error('Bad ' + name + ' (expected YYYY-MM-DD): ' + v);
            return "'" + v + "'";
          }
          case 'string':
          default: {
            const s = String(v == null ? '' : v);
            if (def.max_length && s.length > def.max_length)
              throw new Error('Bad ' + name + ' (too long)');
            const pat = def.pattern ? new RegExp(def.pattern) : /^[A-Za-z0-9 _.+@-]*$/;
            if (!pat.test(s))
              throw new Error('Bad ' + name + ' (pattern mismatch)');
            return "'" + s.replace(/'/g, "''") + "'";
          }
        }
      },
    );
  };
}

// ============================================================
// Run-state isolation — token guard for racing fetches.
// ============================================================
let runCounter = 0;
export const run = {
  next: () => ++runCounter,
  is: (token) => token === runCounter,
};

// ============================================================
// Query ledger
// ============================================================
export function createLedger() {
  const items = {};
  const order = [];
  let mountEl = null;

  function render() {
    if (!mountEl) return;
    mountEl.innerHTML = order.map((id, i) => {
      const d = items[id];
      if (!d) return '';
      const cls = d.status === 'OK' ? 'led-ok'
        : d.status === 'Failed' ? 'led-fail'
        : 'led-pend';
      const arrow = d.sql ? '<span class="ledger-toggle">▸</span> ' : '';
      const summary = '<tr data-led-i="' + i + '" style="cursor:'
        + (d.sql ? 'pointer' : 'default') + '">'
        + '<td>' + arrow + fmt.esc(d.label) + '</td>'
        + '<td class="' + cls + '">' + fmt.esc(d.status) + '</td>'
        + '<td>' + fmt.esc(String(d.rows)) + '</td></tr>';
      const sql = d.sql
        ? '<tr class="ledger-row-sql" data-led-i="' + i + '"><td colspan="3"><pre>'
          + fmt.esc(d.sql) + '</pre></td></tr>'
        : '';
      return summary + sql;
    }).join('');
    mountEl.querySelectorAll('tr[data-led-i]:not(.ledger-row-sql)').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = tr.getAttribute('data-led-i');
        const sqlRow = mountEl.querySelector(
          'tr.ledger-row-sql[data-led-i="' + idx + '"]');
        const toggle = tr.querySelector('.ledger-toggle');
        if (sqlRow) {
          const open = sqlRow.classList.toggle('open');
          if (toggle) toggle.classList.toggle('open', open);
        }
      });
    });
  }

  return {
    mount(el) { mountEl = el; render(); },
    add(id, label, role) {
      if (!items[id]) order.push(id);
      items[id] = {
        label: label || id,
        role: role || 'primary',
        status: 'Pending',
        rows: '—',
        sql: '',
      };
      render();
    },
    up(id, status, rows, sql) {
      const it = items[id];
      if (!it) return;
      if (status !== undefined) it.status = status;
      if (rows !== undefined) it.rows = rows;
      if (sql !== undefined) it.sql = sql;
      render();
    },
    // Test-facing: read raw state.
    _items: () => items,
    _order: () => order.slice(),
  };
}

// ============================================================
// Markdown — minimal subset.
// ============================================================
export function renderTinyMarkdown(src) {
  const esc = fmt.esc;
  const blocks = String(src).split(/\n\s*\n+/);
  return blocks.map((b0) => {
    const b = b0.replace(/\r/g, '');
    let m;
    if ((m = b.match(/^###\s+(.*)$/m))) return '<h3>' + inline(esc(m[1])) + '</h3>';
    if ((m = b.match(/^##\s+(.*)$/m)))  return '<h2 style="text-transform:none;font-size:14px">' + inline(esc(m[1])) + '</h2>';
    if ((m = b.match(/^#\s+(.*)$/m)))   return '<h2 style="text-transform:none;font-size:16px">' + inline(esc(m[1])) + '</h2>';
    if (/^\s*-\s+/.test(b)) {
      const items = b.split(/\n/).map((line) => {
        const im = line.match(/^\s*-\s+(.*)$/);
        return im ? '<li>' + inline(esc(im[1])) + '</li>' : '';
      }).join('');
      return '<ul>' + items + '</ul>';
    }
    return '<p>' + inline(esc(b)) + '</p>';
  }).join('\n');

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*]+)\*(\W|$)/g, '$1<em>$2</em>$3');
  }
}

// ============================================================
// Badge class picker (used by `table`).
// ============================================================
export function pickBadgeClass(spec, raw) {
  if (!spec) return null;
  const thresholds = [];
  Object.keys(spec).forEach((k) => {
    const m = String(k).match(/^(\d+(?:\.\d+)?)\+$/);
    if (m) thresholds.push({ min: Number(m[1]), cls: String(spec[k]) });
    else if (typeof spec[k] === 'number') thresholds.push({ min: spec[k], cls: k });
  });
  if (!thresholds.length) return null;
  thresholds.sort((a, b) => b.min - a.min);
  const n = Number(raw);
  if (!isFinite(n)) return null;
  for (let i = 0; i < thresholds.length; i++) {
    if (n >= thresholds[i].min) return thresholds[i].cls;
  }
  return thresholds[thresholds.length - 1].cls;
}

// ============================================================
// CSV export (used by `table`).
// ============================================================
export function buildCsv(panel, rows) {
  const cols = panel.columns || [];
  function field(s) {
    return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  }
  const lines = [cols.map((c) => field(c.label || c.key)).join(',')];
  rows.forEach((r) => {
    lines.push(cols.map((c) => field(r[c.key])).join(','));
  });
  return lines.join('\n');
}

function triggerCsvDownload(panel, rows) {
  const csv = buildCsv(panel, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = ((panel.id || 'table') + '.csv').replace(/[^A-Za-z0-9._-]+/g, '-');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
// Panel renderers — each returns the panel's root HTMLElement and
// installs state.update(rows) for follow-up data writes.
// ============================================================
export const PANELS = {
  'kpi-strip': renderKpiStrip,
  'table':     renderTable,
  'bars':      renderBars,
  'markdown':  renderMarkdown,
  'hero':      renderHero,
  'html':      renderHtml,
  'script':    renderScript,
};

function renderKpiStrip(panel, state, ctx) {
  const strip = document.createElement('div');
  strip.className = 'kpi-strip';
  const tileEls = (panel.tiles || []).map((t) => {
    const c = document.createElement('div');
    c.className = 'card kpi';
    if (t.accent) c.setAttribute('data-accent', t.accent);
    const v = document.createElement('div'); v.className = 'v loading skeleton';
    const l = document.createElement('div'); l.className = 'l';
    l.textContent = t.label || t.key;
    c.appendChild(v); c.appendChild(l);
    let n = null;
    if (t.note_key || t.note) {
      n = document.createElement('div');
      n.className = 'n';
      c.appendChild(n);
    }
    strip.appendChild(c);
    return { tile: t, v, n };
  });
  state.update = function (rows) {
    const row = rows[0] || {};
    tileEls.forEach((te) => {
      te.v.classList.remove('loading', 'skeleton');
      te.v.textContent = applyFormat(
        ctx.api, te.tile.format || 'raw', row[te.tile.key], te.tile.format_fn);
      if (te.n) {
        const raw = te.tile.note_key ? row[te.tile.note_key] : te.tile.note;
        te.n.textContent = applyFormat(
          ctx.api, te.tile.note_format || 'raw', raw, te.tile.note_format_fn);
      }
    });
  };
  return strip;
}

function renderTable(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const tbl = document.createElement('table');
  const thead = document.createElement('thead');
  const trh = document.createElement('tr');
  (panel.columns || []).forEach((c) => {
    const th = document.createElement('th');
    if (c.align === 'right') th.className = 'right';
    th.textContent = c.label || c.key;
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  tbl.appendChild(thead);
  const tbody = document.createElement('tbody');
  const colCount = (panel.columns || []).length || 1;
  let skel = '';
  for (let sr = 0; sr < 3; sr++) {
    skel += '<tr>';
    for (let sc = 0; sc < colCount; sc++) {
      skel += '<td><span class="skeleton" style="display:inline-block;width:'
        + (sc === 0 ? 60 : 40 + (sc * 7) % 30)
        + '%;height:10px"></span></td>';
    }
    skel += '</tr>';
  }
  tbody.innerHTML = skel;
  tbl.appendChild(tbody);
  card.appendChild(tbl);

  if (panel.export !== false) {
    const actions = document.createElement('div');
    actions.className = 'table-actions';
    const btn = document.createElement('button');
    btn.className = 'btn-mini';
    btn.type = 'button';
    btn.textContent = 'Export CSV';
    btn.addEventListener('click', () => triggerCsvDownload(panel, state.rows || []));
    actions.appendChild(btn);
    card.appendChild(actions);
  }

  state.update = function (rows) {
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="' + colCount + '" style="color:var(--fg-dim)">'
        + fmt.esc(panel.empty_text || 'no data') + '</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      return '<tr>' + (panel.columns || []).map((c) => {
        const raw = r[c.key];
        let cell = applyFormat(ctx.api, c.format || 'raw', raw, c.format_fn);
        const badgeCls = pickBadgeClass(c.badge, raw);
        if (badgeCls) {
          cell = '<span class="cell-badge cell-badge-' + fmt.esc(badgeCls) + '">'
            + cell + '</span>';
        }
        return '<td' + (c.align === 'right' ? ' class="right"' : '') + '>' + cell + '</td>';
      }).join('') + '</tr>';
    }).join('');
  };
  state.tbodyEl = tbody;
  return card;
}

function renderBars(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
  card.appendChild(wrap);
  let skel = '';
  for (let bi = 0; bi < 4; bi++) {
    skel += '<div style="display:grid;grid-template-columns:120px 1fr 100px;gap:8px;align-items:center">'
      + '<span class="skeleton" style="height:10px;width:80%"></span>'
      + '<span class="skeleton" style="height:10px;width:' + (60 + bi * 10) + '%"></span>'
      + '<span class="skeleton" style="height:10px;width:50%"></span>'
      + '</div>';
  }
  wrap.innerHTML = skel;

  const labelKey = panel.label_key || 'label';
  const valueKey = panel.value_key || 'value';
  const formatName = panel.format || 'num';

  state.update = function (rows) {
    if (!rows.length) {
      wrap.innerHTML = '<div style="color:var(--fg-dim)">'
        + fmt.esc(panel.empty_text || 'no data') + '</div>';
      return;
    }
    const max = Math.max(1, ...rows.map((r) => Number(r[valueKey]) || 0));
    wrap.innerHTML = rows.map((r) => {
      const v = Number(r[valueKey]) || 0;
      const pctW = (100 * v / max).toFixed(1);
      return '<div style="display:grid;grid-template-columns:120px 1fr 100px;gap:8px;align-items:center;font-size:12px">'
        + '<span>' + fmt.esc(r[labelKey]) + '</span>'
        + '<div class="bar-bg"><div class="bar-fill" style="width:' + pctW + '%"></div></div>'
        + '<span style="text-align:right">' + applyFormat(ctx.api, formatName, v) + '</span>'
        + '</div>';
    }).join('');
  };
  return card;
}

function renderMarkdown(panel, state) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const body = document.createElement('div');
  body.style.cssText = 'font-size:13px;line-height:1.5';
  body.innerHTML = renderTinyMarkdown(panel.text || '');
  card.appendChild(body);
  state.update = function () {};
  return card;
}

function renderHero(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card hero-card';
  card.setAttribute('data-accent', panel.accent || 'primary');
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const p = document.createElement('p');
  card.appendChild(p);

  function renderPlaceholder(row, key, format, highlight) {
    const raw = row[key];
    const v = applyFormat(ctx.api, format || 'raw', raw == null ? '—' : raw);
    if (highlight) return '<span class="hl">' + v + '</span>';
    return v;
  }

  function inlineMd(s) {
    return fmt.esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\W)\*([^*]+)\*(\W|$)/g, '$1<em>$2</em>$3');
  }

  function render(row) {
    const rendered = [];
    const re = /\{\{\s*(\w+)(?:\s*\|\s*(\w+))?\s*(!)?\s*\}\}/g;
    const withSentinels = String(panel.template || '').replace(re,
      (_m, key, format, hl) => {
        rendered.push(renderPlaceholder(row, key, format, !!hl));
        return '\x00' + (rendered.length - 1) + '\x00';
      });
    let html = inlineMd(withSentinels);
    html = html.replace(/\x00(\d+)\x00/g, (_m, i) => rendered[+i]);
    p.innerHTML = html;
  }

  function tryRefresh() {
    const spec = ctx.spec;
    if (!spec || !spec.panels) return;
    const anchor = spec.panels[panel.anchor];
    if (!anchor || !anchor.rows || !anchor.rows.length) {
      p.innerHTML = '<span style="color:var(--fg-dim)">(waiting for '
        + fmt.esc(panel.anchor || '?') + ')</span>';
      return;
    }
    render(anchor.rows[0]);
  }

  state.update = function () {
    tryRefresh();
    if (!state._subscribed && ctx.spec && ctx.spec.on) {
      state._subscribed = true;
      ctx.spec.on('panel:loaded', (ev) => {
        if (ev.id === panel.anchor) tryRefresh();
      });
    }
  };
  return card;
}

// `html` — static markup, optionally with template binding to a query
// result. The html string is rendered into the card body; if `query`
// + `template` are provided, the template uses {{rows[N].field}} and
// is re-rendered each time the query reloads.
//
// IMPORTANT: html is set via innerHTML. The sanitize_panel MV (server
// side) is the security boundary. Don't trust panels read from
// localStorage or from sources that bypass the MV.
function renderHtml(panel, state) {
  const card = document.createElement('div');
  card.className = 'card';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  const body = document.createElement('div');
  body.className = 'dash-html-body';
  card.appendChild(body);

  function renderTemplate(rows) {
    const tpl = String(panel.template || panel.html || '');
    if (!panel.template) return tpl;
    return tpl.replace(/\{\{\s*rows\[(\d+)\]\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (_m, idx, key) => {
        const row = rows[+idx];
        if (!row) return '';
        return fmt.esc(row[key]);
      });
  }

  if (!panel.query) {
    // Static: render once from `html` field.
    body.innerHTML = String(panel.html || '');
    state.update = function () {};
  } else {
    // Templated: re-render each time the query reloads.
    body.innerHTML = '<span class="skeleton" style="height:14px;width:60%"></span>';
    state.update = function (rows) {
      body.innerHTML = renderTemplate(rows || []);
    };
  }
  return card;
}

// `script` — JS escape hatch. Mounts `html` as the DOM shell, then
// executes `script` in an async function with access to DASH.* and
// DASH.spec.*. Wraps in try/catch so a thrown error appears in the
// panel slot and doesn't break siblings.
//
// v1 trust model: ANY authenticated viewer who can load the dashboard
// executes the JS. The sandboxed iframe limits blast radius. v2 will
// gate by ACL.
function renderScript(panel, state, ctx) {
  const card = document.createElement('div');
  card.className = 'card script-panel';
  if (panel.accent) card.setAttribute('data-accent', panel.accent);
  if (panel.title) {
    const h = document.createElement('h2');
    h.textContent = panel.title;
    card.appendChild(h);
  }
  card.insertAdjacentHTML('beforeend', String(panel.html || ''));

  state.update = async function () {
    if (state._scriptRan) return;
    state._scriptRan = true;
    try {
      // Build an async function from the panel's script body. The
      // function has access to DASH (the public API global) so it can
      // call DASH.spec.fetch, DASH.spec.panels, etc.
      // eslint-disable-next-line no-new-func
      const fn = new Function('DASH', 'panel', 'state',
        '"use strict";\nreturn (async () => {\n' + String(panel.script || '') + '\n})();');
      await fn(ctx.api, panel, state);
    } catch (e) {
      const err = document.createElement('p');
      err.style.cssText = 'color:var(--error);font-size:12px';
      err.textContent = 'Script error: ' + ((e && e.message) || String(e));
      card.appendChild(err);
    }
  };
  return card;
}

// ============================================================
// Param controls in the toolbar
// ============================================================
export function buildParamControls(paramDefs, current, onChange) {
  const bar = document.createElement('div');
  bar.className = 'dash-toolbar';
  bar.style.cssText = 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:4px 0 16px;';
  (paramDefs || []).forEach((p) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;color:var(--fg-dim);font-size:12px;';
    const labelTxt = document.createElement('span');
    labelTxt.textContent = p.label || p.name;
    wrap.appendChild(labelTxt);
    let input;
    if (p.type === 'enum') {
      input = document.createElement('select');
      (p.options || []).forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        input.appendChild(o);
      });
      input.value = current[p.name];
    } else if (p.type === 'date') {
      input = document.createElement('input');
      input.type = 'date'; input.value = current[p.name] || '';
    } else if (p.type === 'int') {
      input = document.createElement('input');
      input.type = 'number';
      if (p.min != null) input.min = p.min;
      if (p.max != null) input.max = p.max;
      input.value = current[p.name];
      input.style.width = '90px';
    } else {
      input = document.createElement('input');
      input.type = 'search';
      input.value = current[p.name] || '';
      input.style.width = '220px';
      if (p.placeholder) input.placeholder = p.placeholder;
    }
    function commit() {
      current[p.name] = (p.type === 'int') ? Number(input.value) : input.value;
      onChange(p.name);
    }
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') commit();
    });
    wrap.appendChild(input);
    bar.appendChild(wrap);
  });
  return bar;
}

// ============================================================
// Layout — auto-flow grid by panel.width
// ============================================================
export function layoutPanels(panels, render) {
  let i = 0;
  const rows = document.createDocumentFragment();
  while (i < panels.length) {
    const w = panels[i].width || 12;
    const cls = (w === 6) ? 'row-2' : (w === 4) ? 'row-3' : null;
    if (cls) {
      const rowEl = document.createElement('div');
      rowEl.className = cls;
      const perRow = 12 / w;
      for (let k = 0; k < perRow && i < panels.length && (panels[i].width || 12) === w; k++, i++) {
        rowEl.appendChild(render(panels[i]));
      }
      rows.appendChild(rowEl);
    } else {
      const solo = document.createElement('div');
      solo.style.marginBottom = '16px';
      solo.appendChild(render(panels[i]));
      rows.appendChild(solo);
      i++;
    }
  }
  return rows;
}

// ============================================================
// Panel shell — dispatches on panel.type, returns error tile if unknown.
// ============================================================
export function renderPanelShell(panel, state, ctx) {
  const renderer = PANELS[panel.type];
  if (!renderer) {
    const err = document.createElement('div');
    err.className = 'card';
    err.innerHTML = '<h2>' + fmt.esc(panel.title || panel.type) + '</h2>'
      + '<p style="color:var(--error)">Unknown panel type: ' + fmt.esc(panel.type) + '</p>';
    state.update = function () {};
    return err;
  }
  return renderer(panel, state, ctx);
}

// ============================================================
// Ledger-integrated fetch — wraps the SPA-provided CH_FETCH.
// ============================================================
export function makeDashFetch(api, chFetch, ledger) {
  return async function dashFetch(id, label, sql) {
    if (!ledger._items()[id]) ledger.add(id, label, 'primary');
    ledger.up(id, 'Pending', '—', sql);
    try {
      const r = await chFetch(sql);
      ledger.up(id, 'OK', r.count);
      return r;
    } catch (e) {
      if (e && e.message === 'Auth expired') throw e;
      ledger.up(id, 'Failed', '—');
      throw e;
    }
  };
}

// ============================================================
// SpecRuntime — orchestrates param controls, panel layout, fetches.
// ============================================================
export class SpecRuntime {
  constructor(spec, root, ctx) {
    this._spec = spec;
    this._root = root;
    this._ctx = ctx;  // { api, fetch, ledger }
    this._listeners = {};
    this.params = {};
    this.panels = {};
    (spec.params || []).forEach((p) => { this.params[p.name] = p.default; });
    this._interp = makeInterpolator(spec.params, this.params);
  }

  on(ev, fn) {
    (this._listeners[ev] = this._listeners[ev] || []).push(fn);
  }

  _emit(ev, payload) {
    (this._listeners[ev] || []).forEach((fn) => {
      try { fn(payload); } catch (_e) { /* swallow listener error */ }
    });
  }

  interpolate(sql) {
    return this._interp(sql);
  }

  fetch(label, sql) {
    const id = 'spec:' + String(label).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').slice(0, 40);
    return this._ctx.fetch(id, label, this.interpolate(sql));
  }

  async boot() {
    const self = this;
    const spec = self._spec;
    const root = self._root;
    root.innerHTML = '';

    if (spec.title) {
      document.title = spec.title;
      const h1 = document.createElement('h1');
      h1.textContent = spec.title;
      root.appendChild(h1);
    }
    if (spec.subtitle) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.cssText = 'color:var(--fg-dim);font-size:12px;margin:-6px 0 12px;';
      p.textContent = spec.subtitle;
      root.appendChild(p);
    }

    if ((spec.params || []).length) {
      const bar = buildParamControls(spec.params, self.params, (changedName) => {
        self._rerun(changedName);
      });
      root.appendChild(bar);
    }

    const states = (spec.panels || []).map((panel, idx) => {
      const id = panel.id || ('p' + idx);
      const state = { id, panel, rows: [], update: () => {} };
      state.refresh = () => self._runPanel(panel, state);
      self.panels[id] = state;
      return state;
    });

    const renderCtx = { api: self._ctx.api, spec: self };

    const layout = layoutPanels(spec.panels || [], (panel) => {
      const id = panel.id || ('p' + (spec.panels || []).indexOf(panel));
      const state = self.panels[id];
      attachErrorHelper(state, panel);
      state.el = renderPanelShell(panel, state, renderCtx);
      return state.el;
    });
    root.appendChild(layout);

    // Always-on ledger panel.
    const det = document.createElement('details');
    det.style.marginTop = '16px';
    const sum = document.createElement('summary');
    sum.style.cssText = 'color:var(--fg-dim);font-size:12px;cursor:pointer';
    sum.textContent = 'Query log';
    det.appendChild(sum);
    const tbl = document.createElement('table');
    tbl.innerHTML = '<thead><tr><th>Query</th><th>Status</th><th>Rows</th></tr></thead><tbody id="dash-ledger"></tbody>';
    det.appendChild(tbl);
    root.appendChild(det);
    self._ctx.ledger.mount(tbl.querySelector('#dash-ledger'));

    if (spec.concurrent) {
      await Promise.allSettled(states.map((st) => self._runPanel(st.panel, st)));
    } else {
      for (let si = 0; si < states.length; si++) {
        try { await self._runPanel(states[si].panel, states[si]); } catch (_e) { /* per-panel; continue */ }
      }
    }
  }

  async _runPanel(panel, state) {
    if (!panel.query) {
      try { state.update([]); } catch (_e) { /* renderer error */ }
      return;
    }
    state._epoch = (state._epoch || 0) + 1;
    const myEpoch = state._epoch;
    let sql;
    try {
      sql = this._interp(panel.query);
    } catch (e) {
      state._showError(e.message);
      return;
    }
    try {
      const r = await this._ctx.fetch(state.id, panel.title || state.id, sql);
      if (state._epoch !== myEpoch) return;
      state.rows = r.rows;
      state.update(r.rows);
      this._emit('panel:loaded', { id: state.id, rows: r.rows });
    } catch (e) {
      if (e && e.message === 'Auth expired') return;
      if (state._epoch !== myEpoch) return;
      state._showError((e && e.message) || String(e));
    }
  }

  _rerun(changedName) {
    const self = this;
    const affected = (self._spec.panels || []).filter((p) => {
      if (!changedName) return true;
      if (!p.query) return false;
      return p.query.indexOf('{{' + changedName + '}}') >= 0
        || p.query.indexOf('{{ ' + changedName) >= 0;
    });
    self._emit('params', {
      changed: changedName,
      params: Object.assign({}, self.params),
    });
    affected.forEach((p) => {
      const id = p.id || ('p' + (self._spec.panels || []).indexOf(p));
      const st = self.panels[id];
      self._runPanel(p, st);
    });
  }
}

function attachErrorHelper(state, panel) {
  state._showError = function (msg) {
    if (state.el) {
      state.el.innerHTML = (panel.title ? '<h2>' + fmt.esc(panel.title) + '</h2>' : '')
        + '<p style="color:var(--error);font-size:12px">' + fmt.esc(msg) + '</p>';
    }
  };
}

// ============================================================
// Public entrypoint.
//
// Browser path: SPA shell calls `DASH.renderSpec(spec, rootEl)` after
// the row is fetched and the CH_FETCH global is set.
// ============================================================
export async function renderSpec(spec, rootEl, opts) {
  opts = opts || {};
  const root = rootEl || document.getElementById('dash-root') || document.body;
  if (typeof spec === 'string') {
    try { spec = JSON.parse(spec); }
    catch (e) {
      root.innerHTML = '<pre style="color:#ff6b6b">Bad spec JSON: '
        + fmt.esc(e.message) + '</pre>';
      return null;
    }
  }
  const chFetch = opts.chFetch
    || (typeof window !== 'undefined' && window.CH_FETCH)
    || (() => { throw new Error('CH_FETCH not configured'); });
  const ledger = opts.ledger || createLedger();
  const apiHolder = {};
  const fetch = makeDashFetch(apiHolder, chFetch, ledger);
  const ctx = { api: apiHolder, fetch, ledger };
  const rt = new SpecRuntime(spec, root, ctx);
  // Wire `api` so `script` panels see a stable DASH global with `.spec`.
  Object.assign(apiHolder, {
    version: 'v1',
    fmt,
    run,
    ledger,
    fetch,
    renderSpec,
    spec: rt,
  });
  if (typeof window !== 'undefined') {
    window.DASH = apiHolder;
  }
  rt.ready = rt.boot();
  await rt.ready;
  return rt;
}

// Browser default: attach a stub `DASH` so `<script type="module">`
// loaders that import this file get a global ready for SPA bootstrap.
if (typeof window !== 'undefined' && !window.DASH) {
  window.DASH = {
    version: 'v1',
    fmt,
    run,
    renderSpec,
  };
}
