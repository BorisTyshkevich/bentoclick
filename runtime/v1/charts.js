// bentoclick runtime — chart primitives entry.
//
// Re-exports the chart palette, scale builders, and SVG element
// constructors from `./charts/`. Existing imports (`import {
// chartPalette, svgRoot, ... } from './charts.js'`) keep resolving
// against this entry, which means panel files and tests don't
// change as the charts/ subdirectory grows for Phase 2's heatmap /
// treemap / donut / etc. primitives.
//
// Written as `import` + `export { … }` rather than the shorthand
// `export { … } from '…'` so the iframe bundler's moduleToClassic
// strip works — it removes the imports and the no-from export
// block, leaving the symbols defined in the shared classic-script
// scope after concat. `export { … } from` would otherwise survive
// the strip and crash the eval.

import { chartPalette, colorFor } from './charts/palette.js';
import { linearScale, bandScale, niceTicks } from './charts/scales.js';
import { svgEl, linePath, svgRoot, axisBottom, axisY, annotationLine } from './charts/svg.js';

export {
  chartPalette,
  colorFor,
  linearScale,
  bandScale,
  niceTicks,
  svgEl,
  linePath,
  svgRoot,
  axisBottom,
  axisY,
  annotationLine,
};
