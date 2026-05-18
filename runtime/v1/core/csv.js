// bentoclick runtime — CSV export (used by `table`).
//
// `buildCsv` is pure (panel + rows → string). `triggerCsvDownload`
// is the DOM-side wrapper that wires up the Blob + invisible anchor
// click. Tests cover `buildCsv` directly.

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

export function triggerCsvDownload(panel, rows) {
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
