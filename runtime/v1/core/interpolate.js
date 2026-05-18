// bentoclick runtime — param substitution.
//
// `makeInterpolator` returns a function that takes a template string
// with `{{name}}` placeholders and substitutes each from the current
// param values, with strict per-type validation. Validation failure
// throws — callers (panel renderers + DASH.spec.setParam) catch and
// render the error inline rather than ship the bad value to CH.

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
