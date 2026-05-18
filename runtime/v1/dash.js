// bentoclick runtime v1 — dashboard spec renderer.
//
// Loaded by the SPA shell as `<script type="module" src="/lib/v1/dash.js">`.
// At the bottom this assigns `window.DASH = api` for compatibility with
// `script` panels that reference `DASH.spec.*`. Named exports support
// unit testing in happy-dom (see tests/runtime/unit/).
//
// `spec_version` stays at 1 — the contract (panel JSON shape, param
// types, sanitization rules) is unchanged from the original v1.
// The visual refresh that landed alongside the tweaks panel is a
// pure skin change: dash-theme.css ships new tokens and richer
// panels.css selectors; `<table>` gains a `.bc-tbl` class so the
// new table styling applies. All other class output is unchanged,
// so legacy dashboards (with no re-save) inherit the new look.
//
// SVG chart primitives live in ./charts.js (line/combo/chart renderers
// below). Browsers load this as a module so the relative import
// resolves through the same /lib/v1/ origin as dash.js itself.

import {
  chartPalette,
  colorFor,
  linearScale,
  bandScale,
  niceTicks,
  linePath,
  svgRoot,
  axisBottom,
  axisY,
  annotationLine,
  svgEl,
} from './charts.js';

// Core helpers — moved into ./core/ during the split. dash.js
// re-exports them so tests (and future panel-module imports) keep
// reaching them through the same path.
import { fmt, resolveFormatFn, applyFormat } from './core/fmt.js';
import { makeInterpolator } from './core/interpolate.js';
import { run } from './core/run-state.js';
import { createLedger } from './core/ledger.js';
import { mdInline, renderTinyMarkdown } from './core/markdown.js';
import { pickBadgeClass } from './core/badge.js';
import { buildCsv, triggerCsvDownload } from './core/csv.js';

export { fmt, resolveFormatFn, applyFormat };
export { makeInterpolator };
export { run };
export { createLedger };
export { mdInline, renderTinyMarkdown };
export { pickBadgeClass };
export { buildCsv };

// ============================================================
// Panel renderers — moved into ./panels/ during the dash split.
// Each renderer exports a single function and pulls helpers from
// ./core/, ./panels/_shared.js, or ./panels/chart-helpers.js.
// dash.js's job here is only to assemble the PANELS dispatch and
// re-export each renderer for direct test access.
// ============================================================
import { renderKpiStrip } from './panels/kpi-strip.js';
import { renderTable }    from './panels/table.js';
import { renderBars }     from './panels/bars.js';
import { renderMarkdown } from './panels/markdown.js';
import { renderHero }     from './panels/hero.js';
import { renderCallouts } from './panels/callouts.js';
import { renderHtml }     from './panels/html.js';
import { renderScript }   from './panels/script.js';
import { renderLine }     from './panels/line.js';
import { renderCombo }    from './panels/combo.js';
import { renderChart }    from './panels/chart.js';
import { renderDataset }  from './panels/dataset.js';
import { applyPanelState } from './panels/_shared.js';

export {
  renderKpiStrip,
  renderTable,
  renderBars,
  renderMarkdown,
  renderHero,
  renderCallouts,
  renderHtml,
  renderScript,
  renderLine,
  renderCombo,
  renderChart,
  renderDataset,
  applyPanelState,
};

export const PANELS = {
  'kpi-strip': renderKpiStrip,
  'table':     renderTable,
  'bars':      renderBars,
  'markdown':  renderMarkdown,
  'hero':      renderHero,
  'callouts':  renderCallouts,
  'html':      renderHtml,
  'script':    renderScript,
  'line':      renderLine,
  'combo':     renderCombo,
  'chart':     renderChart,
  'dataset':   renderDataset,
};


// ============================================================
// Param controls in the toolbar
// ============================================================
export function buildParamControls(paramDefs, current, onChange, inputsOut) {
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
    if (inputsOut) inputsOut[p.name] = input;
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
  const el = renderer(panel, state, ctx);
  applyPanelState(el, panel);
  return el;
}

// ============================================================
// Ledger-integrated fetch — wraps the SPA-provided CH_FETCH.
// ============================================================
export function makeDashFetch(api, chFetch, ledger) {
  return async function dashFetch(id, label, sql) {
    if (!ledger._items()[id]) ledger.add(id, label, 'primary');
    ledger.up(id, 'Pending', '—', sql);
    const t0 = (typeof performance !== 'undefined' && performance.now)
      ? performance.now() : Date.now();
    try {
      const r = await chFetch(sql);
      const dt = Math.round(((typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now()) - t0);
      // `elapsedMs` is the wall-clock round-trip we just observed.
      // Panel renderers read it from the ledger to populate `.ph-stamp`
      // (e.g. `1987 – 2025 · 122 ms`).
      r.elapsedMs = dt;
      ledger.up(id, 'OK', r.count, undefined, dt);
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
    this._paramInputs = {};
    this._paramDefs = {};
    (spec.params || []).forEach((p) => {
      this.params[p.name] = p.default;
      this._paramDefs[p.name] = p;
    });
    this._interp = makeInterpolator(spec.params, this.params);
  }

  // setParam(name, value) — called by `on_click` handlers in tables
  // and chart panels. Coerces value to the param's declared type,
  // syncs the toolbar input, and re-runs only panels that interpolate
  // {{name}} in their query. Unknown params are a no-op.
  setParam(name, value) {
    const def = this._paramDefs[name];
    if (!def) return false;
    let coerced = value;
    if (def.type === 'int') {
      const n = Number(value);
      if (!isFinite(n)) return false;
      coerced = Math.trunc(n);
    } else if (def.type === 'date') {
      coerced = String(value);
    } else {
      coerced = String(value == null ? '' : value);
    }
    // Probe-and-revert: the coercion above accepts any string for date/
    // enum/string, and any integer for int regardless of min/max. The
    // strict per-type validation lives in the interpolator. If we stored
    // a bad value here it would pass setParam, sync the toolbar, then
    // throw on the first re-fetched panel — red-screening every sibling.
    // Probing against `{{name}}` runs the same validation the panel SQL
    // would, with the value already in `this.params`.
    const prev = this.params[name];
    this.params[name] = coerced;
    try { this._interp('{{' + name + '}}'); }
    catch (_) { this.params[name] = prev; return false; }
    const inp = this._paramInputs[name];
    if (inp) inp.value = coerced;
    this._rerun(name);
    return true;
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
      }, self._paramInputs);
      root.appendChild(bar);
    }

    const states = (spec.panels || []).map((panel, idx) => {
      const id = panel.id || ('p' + idx);
      const state = { id, panel, idx, rows: [], update: () => {} };
      state.refresh = () => self._runPanel(panel, state);
      installLoadedDeferred(state);
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
    state._epoch = (state._epoch || 0) + 1;
    const myEpoch = state._epoch;
    // Source-backed branch — waits on the source panel's _loaded
    // promise, then (optionally) reshapes rows via panel.transform.
    if (panel.source) {
      if (panel.query) {
        state._showError('panel cannot set both "query" and "source"');
        resolveLoaded(state);
        return;
      }
      const src = this.panels[panel.source];
      if (!src) {
        state._showError('unknown source: ' + panel.source);
        resolveLoaded(state);
        return;
      }
      if (src.idx >= state.idx) {
        state._showError('source "' + panel.source + '" must be declared before consumer');
        resolveLoaded(state);
        return;
      }
      try {
        await src._loaded;
      } catch (_e) { /* unreachable: _loaded never rejects */ }
      if (state._epoch !== myEpoch) return;
      let rows = src.rows || [];
      if (panel.transform) {
        try {
          rows = runTransform(panel.transform, rows, this.params);
        } catch (e) {
          state._showError((e && e.message) || String(e));
          resolveLoaded(state);
          return;
        }
      }
      try {
        state.rows = rows;
        state.update(rows);
        this._emit('panel:loaded', { id: state.id, rows });
      } catch (_e) { /* renderer error */ }
      resolveLoaded(state);
      return;
    }
    if (!panel.query) {
      try { state.update([]); } catch (_e) { /* renderer error */ }
      resolveLoaded(state);
      return;
    }
    let sql;
    try {
      sql = this._interp(panel.query);
    } catch (e) {
      state._showError(e.message);
      resolveLoaded(state);
      return;
    }
    try {
      const r = await this._ctx.fetch(state.id, panel.title || state.id, sql);
      if (state._epoch !== myEpoch) return;
      state.rows = r.rows;
      if (typeof r.elapsedMs === 'number') state.elapsedMs = r.elapsedMs;
      state.update(r.rows);
      this._emit('panel:loaded', { id: state.id, rows: r.rows });
      resolveLoaded(state);
    } catch (e) {
      if (e && e.message === 'Auth expired') {
        resolveLoaded(state);
        return;
      }
      if (state._epoch !== myEpoch) return;
      state._showError((e && e.message) || String(e));
      resolveLoaded(state);
    }
  }

  _rerun(changedName) {
    const self = this;
    const panels = self._spec.panels || [];
    const directlyAffected = new Set();
    panels.forEach((p) => {
      if (!changedName) { directlyAffected.add(p); return; }
      if (!p.query) return;
      if (p.query.indexOf('{{' + changedName + '}}') >= 0
        || p.query.indexOf('{{ ' + changedName) >= 0) {
        directlyAffected.add(p);
      }
    });
    // Closure over source edges: any consumer whose source is in the
    // affected set joins it. Linear sweep is fine — panels are
    // declared in dependency order (source before consumer).
    let grew = true;
    while (grew) {
      grew = false;
      panels.forEach((p) => {
        if (directlyAffected.has(p)) return;
        if (!p.source) return;
        const src = self.panels[p.source];
        if (src && directlyAffected.has(src.panel)) {
          directlyAffected.add(p);
          grew = true;
        }
      });
    }
    self._emit('params', {
      changed: changedName,
      params: Object.assign({}, self.params),
    });
    // Reset _loaded deferreds before kicking off the re-runs so any
    // consumer that already awaited the prior promise sees a fresh one.
    directlyAffected.forEach((p) => {
      const id = p.id || ('p' + panels.indexOf(p));
      const st = self.panels[id];
      if (st) installLoadedDeferred(st);
    });
    directlyAffected.forEach((p) => {
      const id = p.id || ('p' + panels.indexOf(p));
      const st = self.panels[id];
      self._runPanel(p, st);
    });
  }
}

// Per-state load deferred — every state has one, recreated on each
// re-run. Source consumers `await src._loaded` to serialize behind
// the source panel's first successful (or failed) settle.
function installLoadedDeferred(state) {
  state._loaded = new Promise((resolve) => { state._loadedResolve = resolve; });
}
function resolveLoaded(state) {
  if (state._loadedResolve) {
    state._loadedResolve();
    state._loadedResolve = null;
  }
}

// runTransform — executes a user-authored JS function body that maps
// `rows` (frozen, deep) to a new array. The function runs in global
// scope via `new Function`, so closures over `DASH` / `ctx` / `this`
// are not available. Sync only; async transforms are out of scope.
export function runTransform(body, rows, params) {
  const fn = new Function('rows', 'params', '"use strict";\n' + String(body));
  const frozenRows = Object.freeze((rows || []).map((r) => {
    if (r && typeof r === 'object') return Object.freeze(Object.assign({}, r));
    return r;
  }));
  const frozenParams = Object.freeze(Object.assign({}, params || {}));
  const out = fn(frozenRows, frozenParams);
  if (!Array.isArray(out)) {
    throw new Error('transform must return an array, got ' + (out === null ? 'null' : typeof out));
  }
  return out;
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
