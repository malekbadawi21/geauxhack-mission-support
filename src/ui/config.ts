// config.ts — UI-only settings: the product name and the replay pacing.
//
// How it fits: every component imports the product name from here, so renaming the product is a
// one-line change. The replay timings only pace the demo animation; they never touch any number the
// analysis produces. Browser-safe, no logic.

// Placeholder product name (Malek picks the final one). Shown in the header and the page title.
export const PRODUCT_NAME = "Mission Support";

// Replay pacing, in milliseconds. Chosen so the whole Jan 13 replay takes about 7 seconds on stage:
// long enough to follow, short enough not to drag. The real tool timings stay in the trace.
export const REPLAY_MS = {
  readPerFile: 800, // "Reading reports", per uploaded file
  verify: 1000, // "Verifying quotes"
  analyze: 700, // "Updating analysis"
  traceStep: 900, // one agent trace step appearing
  finish: 400, // pause before "Daily report ready"
};

// In live mode the trace arrives all at once; steps are still revealed one by one, but faster.
export const LIVE_TRACE_STEP_MS = 250;

// The simulated one-way Mars–Earth signal delay the message-to-Earth note refers to (minutes).
export const ONE_WAY_DELAY_MINUTES = 20;
