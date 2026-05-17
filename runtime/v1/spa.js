// dash — SPA bootstrap JS for /app, /v/<owner>/<slug>, /p/<name>.
//
// Served from ClickHouse user_files as file://dash/spa.js by the handler at
// /lib/v1/spa.js. The SPA shell references this as
// <script src="/lib/v1/spa.js">, which lets a strict CSP on the shell avoid
// inline bootstrap code.
//
// Data path: this shell calls ClickHouse HTTPS DIRECTLY (the CH_URL from
// /config.json) with the OAuth bearer in the Authorization header. The MCP
// is used only for the OAuth bootstrap (RFC 9728 protected-resource
// discovery, /oauth/authorize, /oauth/token).
//
// Source: adapted from /Users/Workspaces/altinity/altinity-claude-otel/clickhouse/content/spa/bootstrap.js
//
// Deploy: see dash/install.sh — pushes this file via
// INSERT INTO FUNCTION file('dash/spa.js', 'RawBLOB', 'String') ...
(function(){
'use strict';

// ---- Runtime config (loaded from /config.json before main()) ----
var CFG       = null;                    // populated by loadConfig() at boot
var MCP       = null;                    // CFG.mcp_url    — OAuth AS / RS root
var CH_URL    = null;                    // CFG.ch_url     — data-path origin
var DB        = null;                    // CFG.db         — dashboards database name
var DOMAIN    = null;                    // CFG.email_domain (e.g. "altinity.com") — '' to disable expansion
var TOK_KEY   = 'mcp_tok';
var OLD_CID_KEYS = ['mcp_cid', 'mcp_cid_v2'];
var CID_KEY   = 'mcp_cid_v3';
var CLIENT_KEY = 'mcp_oauth_client_id';
var OLD_AS_KEY = 'mcp_as_meta';
var AS_KEY    = 'mcp_as_meta_v2';
var CIMD_PATH = '/oauth/client.json';
var VER_KEY   = 'pkce_v';
var STATE_KEY = 'pkce_state';
// SAFE: allow chars that appear in an email localpart (+) and in full-email
// owner URLs (@) so /v/<full-email>/<slug> works. owners and slugs are
// quote-escaped via sqlStr() before splicing into SQL, but we still apply
// a conservative character allowlist as defense in depth.
var SAFE      = /^[A-Za-z0-9._+@-]+$/;
var FETCH_MS  = 20000;

// Storage helpers. The SPA can render inside a sandbox-without-same-origin
// frame (e.g. someone embedded /app in a chat-runtime iframe); in that case
// localStorage/sessionStorage throw on every access. We detect once at startup
// and fall back to a per-page-load in-memory store so the script doesn't crash
// — though OAuth state can't persist across loads in that environment.
var STORAGE_AVAILABLE = (function () {
  try { localStorage.getItem('__probe__'); return true; }
  catch (_) { return false; }
})();
var memStore = {};
function lsGet(k)    { try { return STORAGE_AVAILABLE ? localStorage.getItem(k) : (memStore[k] || null); } catch (_) { return memStore[k] || null; } }
function lsSet(k, v) { try { if (STORAGE_AVAILABLE) localStorage.setItem(k, v); else memStore[k] = v; } catch (_) { memStore[k] = v; } }
function lsDel(k)    { try { if (STORAGE_AVAILABLE) localStorage.removeItem(k); delete memStore[k]; } catch (_) { delete memStore[k]; } }
function ssGet(k)    { try { return STORAGE_AVAILABLE ? sessionStorage.getItem(k) : (memStore[k] || null); } catch (_) { return memStore[k] || null; } }
function ssSet(k, v) { try { if (STORAGE_AVAILABLE) sessionStorage.setItem(k, v); else memStore[k] = v; } catch (_) { memStore[k] = v; } }
function ssDel(k)    { try { if (STORAGE_AVAILABLE) sessionStorage.removeItem(k); delete memStore[k]; } catch (_) { delete memStore[k]; } }

OLD_CID_KEYS.forEach(function(k){ lsDel(k); });
lsDel(OLD_AS_KEY);

function setStatus(msg, isErr) {
  var el = document.getElementById('msg');
  if (el) { el.textContent = msg; el.className = isErr ? 'err' : ''; }
  var actions = document.getElementById('actions');
  if (!actions) return;
  if (isErr) {
    actions.innerHTML =
      '<a id="retry" href="#">Retry</a>' +
      '<a id="relogin" href="#">Log in again</a>';
    actions.classList.remove('hide');
    document.getElementById('retry').onclick = function(e){ e.preventDefault(); location.reload(); };
    document.getElementById('relogin').onclick = function(e){
      e.preventDefault();
      lsDel(TOK_KEY);
      lsDel(CID_KEY);
      lsDel(CLIENT_KEY);
      lsDel(AS_KEY);
      location.reload();
    };
  } else {
    actions.classList.add('hide');
    actions.innerHTML = '';
  }
}

function showFrame() {
  document.getElementById('status').classList.add('hide');
  document.getElementById('frame').classList.remove('hide');
}

function withTimeout(input, init) {
  init = init || {};
  var ctrl = new AbortController();
  var t = setTimeout(function(){ ctrl.abort(); }, FETCH_MS);
  init.signal = ctrl.signal;
  return fetch(input, init).finally(function(){ clearTimeout(t); });
}

// ---- Runtime config ----
// Loaded at startup. Server-side `Cache-Control: no-store` makes re-config
// fast: reload the page after `INSERT INTO FUNCTION file('dash/config.json', ...)`.
async function loadConfig() {
  var r = await withTimeout('/config.json', { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
  if (!r.ok) throw new Error('config.json fetch failed: HTTP ' + r.status);
  var j = await r.json();
  if (!j.mcp_url || !j.ch_url) throw new Error('config.json missing mcp_url or ch_url');
  CFG    = j;
  MCP    = j.mcp_url.replace(/\/$/, '');
  CH_URL = j.ch_url.replace(/\/$/, '');
  DB     = j.db || 'dashboards';
  DOMAIN = j.email_domain ? ('@' + j.email_domain) : '';
  if (j.brand_name) document.title = j.brand_name;
}

function parseRoute() {
  var p = location.pathname;
  var q = new URLSearchParams(location.search);
  var m;
  if ((m = p.match(/^\/v\/([^\/]+)\/([^\/]+)\/?$/))) {
    return { kind: 'dashboard', owner: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]) };
  }
  if ((m = p.match(/^\/p\/([^\/]+)\/?$/))) {
    return { kind: 'page', name: decodeURIComponent(m[1]) };
  }
  if (p === '/app' || p === '/app/' || p === '/') {
    var d = q.get('dashboard');
    if (d) {
      var parts = d.split('/');
      if (parts.length === 2) return { kind: 'dashboard', owner: parts[0], slug: parts[1] };
    }
    var n = q.get('page');
    if (n) return { kind: 'page', name: n };
    // /app with no args → built-in index listing the caller's own dashboards.
    return { kind: 'index' };
  }
  return { kind: 'unknown' };
}

// ---- PKCE S256 ----
function randBytes(n) {
  var b = new Uint8Array(n); crypto.getRandomValues(b); return b;
}
function b64url(bytes) {
  var s = btoa(String.fromCharCode.apply(null, bytes));
  return s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function randVerifier() { return b64url(randBytes(32)); }
async function challenge(verifier) {
  var h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(h));
}

// Discover the OAuth AS via RFC 9728 protected-resource metadata against the
// MCP, then fetch AS-level metadata so we know where to /authorize and /token.
async function discoverAS() {
  var rs = await withTimeout(MCP + '/.well-known/oauth-protected-resource', { headers: { 'Accept': 'application/json' } });
  if (!rs.ok) throw new Error('protected-resource discovery failed: HTTP ' + rs.status);
  var pr = await rs.json();
  var asUrl = (pr.authorization_servers || [])[0];
  if (!asUrl) throw new Error('No authorization_servers in protected-resource metadata');

  var cached = null;
  try { cached = JSON.parse(lsGet(AS_KEY) || 'null'); } catch (_) {}
  if (cached && cached.issuer === asUrl && cached.authorization_endpoint && cached.token_endpoint && Object.prototype.hasOwnProperty.call(cached, 'client_id_metadata_document_supported')) {
    return cached;
  }

  var base = asUrl.replace(/\/$/, '');
  var meta = null;
  for (var path of ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration']) {
    var r = await withTimeout(base + path, { headers: { 'Accept': 'application/json' } });
    if (r.ok) { meta = await r.json(); break; }
  }
  if (!meta) throw new Error('AS metadata discovery failed for ' + asUrl);
  meta.issuer = meta.issuer || asUrl;

  // Mode-flip cleanup: if the AS issuer changed since last use, drop the
  // cached client_id (the old client state is meaningless against the new AS).
  if (cached && cached.issuer !== meta.issuer) {
    lsDel(CID_KEY);
    lsDel(CLIENT_KEY);
  }
  lsSet(AS_KEY, JSON.stringify(meta));
  return meta;
}

// CIMD-only: SPA's client_id is the URL of its own /oauth/client.json.
function oauthClientId() {
  var cid = location.origin + CIMD_PATH;
  lsSet(CLIENT_KEY, cid);
  return cid;
}

function safeReturnTo(s) {
  if (typeof s !== 'string' || s.length === 0 || s.length > 2048) return '/';
  if (!/^\/[^/]/.test(s)) return '/';
  if (/^\/mcp-callback(?:[/?#]|$)/.test(s)) return '/';
  return s;
}

async function startAuth(returnTo) {
  var meta = await discoverAS();
  if (meta.client_id_metadata_document_supported !== true) {
    throw new Error('Authorization server does not support CIMD (client_id_metadata_document_supported != true). dash requires CIMD.');
  }
  var cid = oauthClientId();
  var v = randVerifier();
  ssSet(VER_KEY, v);
  var state = b64url(randBytes(16));
  ssSet(STATE_KEY, JSON.stringify({
    state: state,
    return_to: safeReturnTo(returnTo),
    ts: Date.now()
  }));
  var c = await challenge(v);
  var u = new URL(meta.authorization_endpoint);
  u.searchParams.set('client_id', cid);
  u.searchParams.set('redirect_uri', location.origin + '/mcp-callback');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('code_challenge', c);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  u.searchParams.set('scope', 'openid email');
  // RFC 8707 Resource Indicator. Required so the AS issues a token whose
  // `aud` byte-equals the MCP URL (matches MCP's RFC 9728 advertisement).
  u.searchParams.set('resource', MCP + '/');
  location.replace(u.toString());
}

function clearTokenAndRestart() {
  lsDel(TOK_KEY);
  location.reload();
}

// ---- Content fetch via ClickHouse HTTP, direct ----
// URL segments are whitelisted by SAFE before being embedded in SQL.
function sqlStr(s) { return "'" + s.replace(/'/g, "''") + "'"; }

async function chQuery(sql) {
  var tok = lsGet(TOK_KEY);
  if (!tok) throw new Error('Auth expired');
  // Direct CH HTTP. CH's <token_processor> resolves the JWT and runs the
  // query under currentUser() = the OAuth subject's email. No MCP hop.
  var u = new URL(CH_URL + '/');
  u.searchParams.set('query', sql);
  u.searchParams.set('default_format', 'JSONCompact');
  var r = await withTimeout(u.toString(), { headers: { 'Authorization': 'Bearer ' + tok } });
  if (r.status === 401 || r.status === 403) throw new Error('Auth expired');
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + (await r.text()).slice(0, 400));
  return await r.json();
}

function assertSafe(name, v) {
  if (!SAFE.test(v)) throw new Error('Invalid ' + name + ': only [A-Za-z0-9._-] allowed');
  if (v.length > 128) throw new Error(name + ' too long');
}

async function fetchDashboard(owner, slug) {
  assertSafe('owner', owner); assertSafe('slug', slug);
  // URL convention is email localpart; DB stores full email (the MV
  // computes owner = currentUser()). When DOMAIN is configured, accept
  // both localpart and full-email forms; otherwise require full email.
  var forms = owner.indexOf('@') >= 0 ? [owner]
            : DOMAIN              ? [owner, owner + DOMAIN]
            :                       [owner];
  var inList = forms.map(sqlStr).join(', ');
  // v1 schema: structured columns. We read them as JSON strings via
  // toJSONString() so the SPA can rebuild the spec object client-side
  // without depending on the wire format of nested JSON columns.
  var sql = 'SELECT title, subtitle, concurrent, spec_version,'
          + ' toJSONString(params) AS params_json,'
          + ' toJSONString(panels) AS panels_json,'
          + ' toJSONString(meta) AS meta_json'
          + ' FROM ' + DB + '.dashboards FINAL'
          + ' WHERE owner IN (' + inList + ')'
          + ' AND slug = ' + sqlStr(slug)
          + ' LIMIT 1';
  var d = await chQuery(sql);
  var rows = d.data || d.rows || [];
  if (!rows.length) throw new Error('Dashboard not found: ' + owner + '/' + slug);
  var r = rows[0];
  var spec = {
    title:        r[0] || '',
    subtitle:     r[1] || '',
    concurrent:   !!r[2],
    spec_version: Number(r[3]) || 1,
  };
  try { spec.params = JSON.parse(r[4] || '[]'); } catch (_) { spec.params = []; }
  try { spec.panels = JSON.parse(r[5] || '[]'); } catch (_) { spec.panels = []; }
  try { spec.meta   = JSON.parse(r[6] || '{}'); } catch (_) { spec.meta = {}; }
  return synthesizeSpecWrapper(spec);
}

// Wrap a spec into a minimal HTML doc that loads /lib/v<N>/dash.js as
// an ES module and invokes renderSpec into #dash-root.
//
// spec_version selects the runtime version. Multiple runtime versions
// coexist; old dashboards keep rendering with their original runtime.
//
// Spec JSON is inlined into an inline <script>; we escape `</` to
// defuse any `</script>` breakout payload (well-known XSS guard for
// inlined JSON-in-script). The sanitize_panel MV scrubbed the panels
// server-side; this layer is defense-in-depth.
function synthesizeSpecWrapper(spec) {
  var v = Math.max(1, Math.min(255, Number(spec.spec_version) || 1));
  var specJson = JSON.stringify(spec).replace(/<\/(?=script)/gi, '<\\/');
  return ''
    + '<!doctype html><html lang="en"><head>'
    + '<meta charset="utf-8">'
    + '<link rel="stylesheet" href="/lib/v' + v + '/dash-theme.css">'
    + '</head><body>'
    + '<div id="dash-root"></div>'
    + '<script type="module">\n'
    + '  import { renderSpec } from "/lib/v' + v + '/dash.js";\n'
    + '  (async () => {\n'
    + '    try { await renderSpec(' + specJson + ', document.getElementById("dash-root")); }\n'
    + '    catch (e) {\n'
    + '      document.getElementById("dash-root").innerHTML =\n'
    + '        "<pre style=\\"color:#ff6b6b;white-space:pre-wrap;font:12px ui-monospace\\">renderSpec error:\\n" +\n'
    + '        (e && e.message ? e.message : e) + "</pre>";\n'
    + '    }\n'
    + '  })();\n'
    + '<\/script>'
    + '</body></html>';
}

async function fetchPage(name) {
  assertSafe('name', name);
  if (name.charAt(0) === '_') throw new Error('Page not found: ' + name);
  var sql = 'SELECT content FROM ' + DB + '.pages'
          + ' WHERE name = ' + sqlStr(name)
          + ' LIMIT 1';
  var d = await chQuery(sql);
  var rows = d.data || d.rows || [];
  if (!rows.length) throw new Error('Page not found: ' + name);
  return rows[0][0];
}

// ---- Render ----
//
// Iframe runs under sandbox="allow-scripts" — scripts execute but the iframe
// has a null origin with no access to parent's localStorage, cookies, or the
// Bearer token. CH_FETCH inside the iframe is a postMessage RPC to this
// parent, which holds the bearer and performs the actual query.
//
// Benefit: a malicious dashboard (stored XSS) cannot exfiltrate the Bearer.
// It can still drive queries as the viewer while the tab is open, but can't
// walk away with a reusable credential.
function bootScript() {
  return '<script>\n' +
    '(function(){\n' +
    '  window.CH_ENDPOINT = ' + JSON.stringify(CH_URL) + ';\n' +
    '  var pending = {}, nextId = 0;\n' +
    '  window.addEventListener("message", function(ev){\n' +
    '    if (ev.source !== window.parent) return;\n' +
    '    var m = ev.data;\n' +
    '    if (!m || typeof m.id !== "number" || !pending[m.id]) return;\n' +
    '    var p = pending[m.id]; delete pending[m.id];\n' +
    '    if (m.type === "ch-result") p.resolve({cols: m.cols, rows: m.rows, count: m.count});\n' +
    '    else if (m.type === "ch-error") p.reject(new Error(m.message || "Query failed"));\n' +
    '  });\n' +
    '  window.CH_FETCH = function(sql){\n' +
    '    var id = ++nextId;\n' +
    '    return new Promise(function(resolve, reject){\n' +
    '      pending[id] = {resolve: resolve, reject: reject};\n' +
    '      setTimeout(function(){ if(pending[id]){ delete pending[id]; reject(new Error("Query timed out")); } }, 30000);\n' +
    '      window.parent.postMessage({type: "ch-query", id: id, sql: sql}, ' + JSON.stringify(location.origin) + ');\n' +
    '    });\n' +
    '  };\n' +
    '})();\n' +
    '<\/script>\n';
}

function renderIntoFrame(html) {
  var frame = document.getElementById('frame');
  frame.addEventListener('load', function onload(){
    frame.removeEventListener('load', onload);
    showFrame();
  });
  frame.srcdoc = bootScript() + html;
}

// ---- postMessage handler for iframe's CH_FETCH RPC ----
function handleIframeMessage(ev) {
  var frame = document.getElementById('frame');
  if (!frame || ev.source !== frame.contentWindow) return;
  if (ev.origin !== 'null') return;
  var m = ev.data;
  if (!m || typeof m !== 'object' || m.type !== 'ch-query') return;
  var id = m.id, sql = m.sql;
  if (typeof id !== 'number' || typeof sql !== 'string') return;
  chQuery(sql).then(function(j){
    var cols = j.columns || (j.meta ? j.meta.map(function(c){return c.name;}) : []);
    // CH HTTP JSONCompact: { meta:[{name,type},...], data:[[...]], rows:N }
    //   where `rows` is the row count (number), `data` is the array.
    // MCP /openapi/execute_query: { columns:[...], rows:[[...]], count:N }
    //   where `rows` is the array.
    var rowsRaw = Array.isArray(j.data) ? j.data : (Array.isArray(j.rows) ? j.rows : []);
    var rows = rowsRaw.map(function(r){ var o = {}; cols.forEach(function(c,i){ o[c] = r[i]; }); return o; });
    // targetOrigin: the sandboxed iframe has origin "null"; "*" is required
    // (the literal string "null" is rejected by postMessage). Defense in
    // depth is the iframe's own listener filter (source === window.parent).
    var count = (typeof j.count === 'number') ? j.count
              : (typeof j.rows === 'number')  ? j.rows
              : rowsRaw.length;
    frame.contentWindow.postMessage(
      { type: 'ch-result', id: id, cols: cols, rows: rows, count: count },
      '*'
    );
  }).catch(function(e){
    if (e.message === 'Auth expired') { clearTokenAndRestart(); return; }
    frame.contentWindow.postMessage(
      { type: 'ch-error', id: id, message: String(e.message || e).slice(0, 400) },
      '*'
    );
  });
}

window.addEventListener('message', handleIframeMessage);

// ---- built-in index dashboard ----
// Rendered when the user hits /app with no query args. Lists the
// authenticated user's own dashboards (owner = currentUser()) with a link
// to open each one in a new tab.
var INDEX_HTML = [
'<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">',
'<title>My dashboards</title>',
'<link rel="stylesheet" href="/lib/v1/dash-theme.css">',
'<style>',
'.toolbar{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap}',
'.toolbar input{width:300px}',
'table.dash-list td.title a{color:var(--accent);text-decoration:none;font-weight:600}',
'table.dash-list td.title a:hover{text-decoration:underline}',
'/* spec-backed dashboards get a dashed underline (a quiet hint at',
'   the storage shape — html-only rows render with the default style). */',
'table.dash-list td.title a.spec{border-bottom:1px dashed var(--accent);padding-bottom:1px}',
'table.dash-list td.title a.spec:hover{text-decoration:none;border-bottom-style:solid}',
'table.dash-list td.slug{font-family:ui-monospace,Menlo,monospace;color:var(--fg-dim);font-size:12px}',
'.empty{padding:40px 0;text-align:center;color:var(--fg-dim)}',
'.empty code{background:var(--bg-2);padding:1px 6px;border-radius:3px;color:var(--fg)}',
'.tag{display:inline-block;background:var(--bg-2);color:var(--fg-dim);padding:1px 7px;border-radius:8px;font-size:11px;margin-right:4px}',
'.muted{color:var(--fg-dim);font-size:12px}',
'</style></head><body>',
'<h1>My dashboards</h1>',
'<div class="toolbar">',
'<input id="filter" type="search" placeholder="Filter by title or slug…">',
'<span id="status" class="muted">Loading…</span>',
'<span id="who" class="muted"></span>',
'</div>',
'<table class="dash-list">',
'<thead><tr><th>Title</th><th>Slug</th><th class="right">Size</th><th>Updated</th><th>Tags</th></tr></thead>',
'<tbody id="rows"></tbody></table>',
'<details style="margin-top:16px;"><summary class="muted">Query log</summary>',
'<table><thead><tr><th>Query</th><th>Status</th><th>Rows</th></tr></thead><tbody id="ledger"></tbody></table>',
'</details>',
'<script type="module">',
'import { fmt, run, createLedger, makeDashFetch } from "/lib/v1/dash.js";',
'(function(){',
'  const ledger = createLedger();',
'  const dashFetch = makeDashFetch({}, (sql) => window.CH_FETCH(sql), ledger);',
'  ledger.mount(document.getElementById("ledger"));',
'  var filterInput=document.getElementById("filter");',
'  var statusEl=document.getElementById("status");',
'  var whoEl=document.getElementById("who");',
'  var rowsEl=document.getElementById("rows");',
'  var allRows=[];',
'  function fmtBytes(b){var n=Number(b)||0;if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";return (n/1048576).toFixed(1)+" MB"}',
'  function escAttr(s){return fmt.esc(s).replace(/"/g,"&quot;")}',
'  function render(rows){',
'    if(!rows.length){rowsEl.innerHTML="<tr><td colspan=\\"5\\" class=\\"empty\\">No dashboards yet. INSERT into <code>dashboards.dashboards</code> as the OAuth user to create one.</td></tr>";return}',
'    rowsEl.innerHTML=rows.map(function(r){',
'      // Always link to the full owner form. The SPA only expands localparts',
'      // against the configured email_domain, so users on other domains',
'      // (e.g. @gmail.com when the config is @altinity.com) would 404 if we',
'      // shortened.',
'      var href="/v/"+encodeURIComponent(r.owner||"")+"/"+encodeURIComponent(r.slug);',
'      var tagsHtml=(r.tags||[]).map(function(t){return "<span class=\\"tag\\">"+fmt.esc(t)+"</span>"}).join("");',
'      var updated=String(r.updated_at||"").slice(0,16).replace("T"," ");',
'      return "<tr>"+',
'        "<td class=\\"title\\"><a href=\\""+escAttr(href)+"\\" target=\\"_blank\\" rel=\\"noopener\\">"+fmt.esc(r.title||r.slug)+"</a></td>"+',
'        "<td class=\\"slug\\">"+fmt.esc(r.slug)+"</td>"+',
'        "<td class=\\"right\\">"+fmtBytes(r.content_size)+"</td>"+',
'        "<td>"+fmt.esc(updated)+"</td>"+',
'        "<td>"+tagsHtml+"</td>"+',
'      "</tr>"',
'    }).join("");',
'  }',
'  function applyFilter(){',
'    var q=filterInput.value.trim().toLowerCase();',
'    if(!q)return render(allRows);',
'    render(allRows.filter(function(r){',
'      return String(r.title||"").toLowerCase().indexOf(q)>=0||String(r.slug||"").toLowerCase().indexOf(q)>=0',
'    }));',
'  }',
'  async function load(){',
'    var tok=run.next();',
'    statusEl.textContent="Loading…";',
'    try{',
'      var who=await dashFetch("who","whoami","SELECT email FROM dashboards.whoami");',
'      if(!run.is(tok))return;',
'      whoEl.textContent="(as "+(who.rows[0]?who.rows[0].email:"?")+")";',
'      var r=await dashFetch("mine","My dashboards","SELECT slug, title, owner, length(toJSONString(panels)) AS content_size, updated_at, tags FROM dashboards.dashboards FINAL WHERE owner = currentUser() ORDER BY updated_at DESC LIMIT 200");',
'      if(!run.is(tok))return;',
'      allRows=r.rows||[];',
'      render(allRows);',
'      statusEl.textContent=allRows.length+" dashboard"+(allRows.length===1?"":"s");',
'    }catch(e){',
'      if(e.message==="Auth expired")return;',
'      statusEl.textContent="Error: "+String(e.message||e).slice(0,200);',
'    }',
'  }',
'  filterInput.addEventListener("input",applyFilter);',
'  load();',
'})();',
'<\/script></body></html>'
].join('\n');

// ---- main ----
(async function main(){
  // If the SPA is loaded inside a sandboxed-no-same-origin iframe, OAuth
  // can't persist a token across redirects. Show a clear escape hatch
  // instead of silently looping through the login flow.
  if (!STORAGE_AVAILABLE) {
    var el = document.getElementById('msg');
    if (el) {
      el.className = 'err';
      el.innerHTML = 'This page is embedded in a sandboxed frame and can’t access browser storage, so the OAuth login can’t persist a session. <br><br>Open it in a top-level browser tab: <a id="popout" href="' + location.href + '" target="_top" rel="noopener" style="color:#00d4aa">' + location.href + '</a>';
    }
    return;
  }

  try { await loadConfig(); }
  catch (e) { setStatus('Config error: ' + e.message, true); return; }

  var route = parseRoute();
  if (route.kind === 'unknown') {
    setStatus('No dashboard or page in the URL.\nTry /v/<owner>/<slug> or /p/<name>.', true);
    return;
  }
  if (!lsGet(TOK_KEY)) {
    setStatus('Redirecting to login…');
    try { await startAuth(location.pathname + location.search); }
    catch (e) { setStatus('Login error: ' + e.message, true); }
    return;
  }
  try {
    var label = route.kind === 'dashboard' ? (route.owner + '/' + route.slug)
              : route.kind === 'page'      ? route.name
              :                              'index';
    document.title = label + (CFG.brand_name ? ' — ' + CFG.brand_name : '');
    setStatus('Loading ' + label + '…');
    var html = route.kind === 'dashboard' ? await fetchDashboard(route.owner, route.slug)
             : route.kind === 'page'      ? await fetchPage(route.name)
             :                              INDEX_HTML;
    renderIntoFrame(html);
  } catch (e) {
    if (e.message === 'Auth expired') { clearTokenAndRestart(); return; }
    setStatus(e.message || 'Failed to load', true);
  }
})();
})();
