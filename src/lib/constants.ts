// constants.ts — every threshold the analysis uses, in one place.
//
// How it fits: forecast.ts and flags.ts import these instead of hard-coding numbers, so a judge (or
// Malek) can see every judgment call in one file. Each value marked "our choice" is a number WE
// picked for this tool — it is not NASA or MDRS data and must never be presented as such.
// Real external baselines live in baselines.ts with their sources. Browser-safe.

import type { Resource } from "./schema.ts";

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

// Malek's decision: RUNS_OUT_BEFORE_MISSION_END is "critical" only when the rate rests on at least
// 3 readings; with 2 it is a "warning" labeled as an early estimate.
export const MIN_POINTS_FOR_CRITICAL_FORECAST = 3;

// Our choice: USAGE_SPIKE fires when a day's drop is more than 2× the median earlier daily drop.
export const USAGE_SPIKE_MULTIPLIER = 2;

// Our choice: the median needs at least 3 earlier drops to mean anything; fewer → no spike check.
export const MIN_DROPS_FOR_SPIKE = 3;

// Malek's decision: MISSING_READING only fires for resources the engineering report records every day.
// Others (water_total from commander reports, the loft/trailer numbers on the Jan 17 refill form) are
// reported only occasionally, so their absence on a given day means nothing.
export const DAILY_ENGINEERING_RESOURCES: Resource[] = ["diesel", "propane", "water_static"];

// Our choice: keywords (matched case-insensitively against the VERIFIED report quote, never against
// Gemini's event label) that decide how serious a crew-reported event is. Prefixes so "ruptur"
// catches "rupture" and "ruptured". Anything matching neither list is "info".
export const CRITICAL_EVENT_KEYWORDS = ["ruptur", "leak", "burst", "fire", "injur"];
export const WARNING_EVENT_KEYWORDS = ["fail", "broke", "empty", "frozen", "block", "not working", "not start", "shut down"];

// Malek's decision (Phase 6, K7): the engineering and commander reports often describe the same event
// (Jan 13: "the trailer tank had ruptured" / "The trailer tank … was broken on route"). Two
// crew-reported events on the same day, from DIFFERENT reports, whose verified quotes both name one of
// these things are shown as one flag with both quotes. Matched case-insensitively ("ATV" ⊂ "ATVs").
// "headset" was added after the QA sweep: Jan 15 reports the same broken microphones in both reports.
export const EVENT_KEY_NOUNS = ["trailer tank", "static tank", "loft tank", "ATV", "propane", "diesel", "water heater", "headset"];

// --- Crew identity ---
// Crew name, size and mission end come from this config, never from an extraction: Gemini read page
// numbers ("115", "117") as the crew on two commander reports. Each fact carries where it came from.

export type CrewConfig = {
  name: string;
  size: number; // people on the crew; water scenarios divide by this
  mission_end: string; // YYYY-MM-DD; RUNS_OUT_BEFORE_MISSION_END and water scenarios count to it
  size_source: string;
  size_url: string;
  mission_end_source: string;
};

// mission_end is the date of the LAST Crew 147 engineering report we have
// (data/reports/crew-147/2015-01-23-engineering.txt), not an official rotation end date from MDRS.
export const CREW_147: CrewConfig = {
  name: "MDRS Crew 147",
  size: 7,
  mission_end: "2015-01-23",
  size_source: "Final Mission Report crew roster table (7 members)",
  size_url: "https://mdrs2013.marssociety.org/home/crew-147/final-mission-report",
  mission_end_source: "date of last engineering report",
};

// Crew folder name (data/reports/<crew>/) → its config, so scripts can look a crew up by name.
export const CREWS: Record<string, CrewConfig> = { "crew-147": CREW_147 };
