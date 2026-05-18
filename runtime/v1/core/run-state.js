// bentoclick runtime — run-state token guard.
//
// Each `renderSpec` call bumps `runCounter` so racing fetches from
// older runs can be ignored: an old in-flight refresh checks
// `run.is(myToken)` and bails when the token no longer matches the
// current run. Module-scoped state is fine here because there's at
// most one SpecRuntime active per iframe.

let runCounter = 0;

export const run = {
  next: () => ++runCounter,
  is: (token) => token === runCounter,
};
