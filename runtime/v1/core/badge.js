// bentoclick runtime — threshold-based badge class picker (used by `table`).
//
// Spec is a small object whose keys are either bare numbers (key
// itself is the class name; value is the threshold) or thresholded
// strings of the form `"<min>+"` mapped to a class name. The
// returned class is the one with the largest `min ≤ raw`, or the
// smallest-min class if `raw` is below every threshold.

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
