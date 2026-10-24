// constants.ts — every threshold the analysis uses, in one place.
//
// How it fits: forecast.ts and flags.ts import these instead of hard-coding numbers, so a judge (or
// Malek) can see every judgment call in one file. Each value marked "our choice" is a number WE
// picked for this tool — it is not NASA or MDRS data and must never be presented as such.
// Real external baselines live in baselines.ts with their sources. Browser-safe.

// --- Forecasting (forecast.ts) ---

// Our choice: a percent reading must rise by MORE than 5 percentage points to count as a refill.
// Smaller rises are gauge noise (e.g. a needle wobbling 38% → 40%) and stay in the series.
export const REFILL_THRESHOLD_PERCENT_POINTS = 5;

// Our choice: for non-percent units (cm, gal, …) a refill is a rise larger than 5% of the previous value.
export const REFILL_THRESHOLD_RELATIVE = 0.05;

// Our choice: a rate needs at least 2 readings (one interval). Fewer → no forecast.
export const MIN_POINTS_FOR_FORECAST = 2;

// --- Flags (flags.ts) ---

// Our choice: a percent resource below 25% raises LOW_LEVEL.
export const LOW_LEVEL_PERCENT = 25;

// Mission end used by RUNS_OUT_BEFORE_MISSION_END. This is the date of the LAST Crew 147
// engineering report we have (data/reports/crew-147/2015-01-23-engineering.txt), not an
// official rotation end date from MDRS.
export const MISSION_END_DATE = "2015-01-23";

// Our choice: USAGE_SPIKE fires when a day's drop is more than 2× the median earlier daily drop.
export const USAGE_SPIKE_MULTIPLIER = 2;

// Our choice: the median needs at least 3 earlier drops to mean anything; fewer → no spike check.
export const MIN_DROPS_FOR_SPIKE = 3;

// Our choice: keywords (matched case-insensitively against the VERIFIED report quote, never against
// Gemini's event label) that decide how serious a crew-reported event is. Prefixes so "ruptur"
// catches "rupture" and "ruptured". Anything matching neither list is "info".
export const CRITICAL_EVENT_KEYWORDS = ["ruptur", "leak", "burst", "fire", "injur"];
export const WARNING_EVENT_KEYWORDS = ["fail", "broke", "empty", "frozen", "block", "not working", "not start", "shut down"];
