// forecast.ts — turns one resource's normalized readings into a usage rate and, when it is well
// defined, the number of days until the tank is empty.
//
// How it fits: analyze.ts calls forecastResource() once per resource with the readings up to the
// "as of" date; flags.ts then turns the result into RUNS_OUT_BEFORE_MISSION_END. All math here is
// plain arithmetic — no LLM. Browser-safe.
//
// The method, step by step (thresholds are in constants.ts):
//   1. Start from the latest reading that has a number.
//   2. Walk backwards, collecting earlier readings, and stop at the most recent refill — so a tank
//      that was just filled isn't averaged with its pre-fill level. Also stop at a reading measured
//      differently (e.g. "15cm" with no reference vs "13 cm from the top"), because those numbers
//      can't be compared. Readings with no number ("less than ¾") are skipped as missing data.
//   3. Rate = amount change from first to last reading ÷ days between them = average change per day.
//      Negative means the resource is being used up, for every tank (see "Amount" vs "value" below).
//   4. Days to empty only when "empty" means value 0: percent tanks and depths measured from the
//      bottom. A depth measured from the top (or with no stated reference) only gives a trend.
//
// "Amount" vs "value": for a depth measured from the TOP, a bigger number means LESS water. The
// helper amountChange() flips the sign for those, so "positive = more resource" everywhere.

import type { NormalizedReading } from "./normalize.ts";
import { convertValue } from "./normalize.ts";
import type { Resource } from "./schema.ts";
import { daysBetween } from "./dates.ts";
import {
  MIN_POINTS_FOR_FORECAST,
  REFILL_THRESHOLD_PERCENT_POINTS,
  REFILL_THRESHOLD_RELATIVE,
} from "./constants.ts";

export type Forecast = {
  resource: Resource;
  latest: NormalizedReading | null; // the most recent reading with a number (null if none)
  first: NormalizedReading | null; // the oldest reading in the post-refill window (the rate runs first → latest)
  rate_per_day: number | null; // change in AMOUNT per day, in `latest`'s unit: negative = being used up
  days_to_empty: number | null; // null when it can't be computed with certainty — see `reason`
  points_used: number; // readings in the window after the last refill
  reason: string | null; // why rate or days_to_empty is null (or how to read the rate); null if nothing to explain
};

/**
 * Re-expresses reading `r`'s value in `target`'s unit, if the two readings can be compared at all.
 * @returns  The converted value, or null if values are missing, units can't be converted exactly,
 *           or they are measured from different references (top vs bottom vs unstated).
 * Why it exists: comparing "15cm" (no reference) with "13 cm from the top" would be a guess.
 */
export function comparableValue(r: NormalizedReading, target: NormalizedReading): number | null {
  if (r.value === null || target.value === null || r.unit === null || target.unit === null) return null;
  if (r.measured_from !== target.measured_from) return null;
  return convertValue(r.value, r.unit, target.unit);
}

/**
 * How much the resource changed from `prev` to `cur`, signed so that positive = more resource.
 * @returns  The change in `cur`'s unit, or null if the two readings can't be compared.
 */
export function amountChange(prev: NormalizedReading, cur: NormalizedReading): number | null {
  const before = comparableValue(prev, cur);
  if (before === null || cur.value === null) return null;
  const delta = cur.value - before;
  // Measured from the top: the number is the empty space above the water, so it shrinks as water rises.
  return cur.measured_from === "top" ? -delta : delta;
}

/**
 * True if going from `prev` to `cur` is a refill rather than gauge noise.
 * Rule (constants.ts, our choice): percent → rise of more than 5 points; other units → rise of more
 * than 5% of the previous value. A rise at or below the threshold is noise and stays in the series.
 */
export function isRefill(prev: NormalizedReading, cur: NormalizedReading): boolean {
  const change = amountChange(prev, cur);
  const before = comparableValue(prev, cur);
  if (change === null || before === null) return false;
  if (cur.unit === "percent") return change > REFILL_THRESHOLD_PERCENT_POINTS;
  // Math.abs: the "previous value" is a size, so its sign doesn't matter.
  return change > REFILL_THRESHOLD_RELATIVE * Math.abs(before);
}

/**
 * True if the crew wrote just "Full" but we had no number to put on it (e.g. a cm-depth tank).
 * Why it exists: such a reading has value null, but it still marks a refill, so the forecast window
 * must not reach back past it.
 */
export function saysFullWithoutNumber(r: NormalizedReading): boolean {
  // normalize.ts turns a raw_text of just "full" into status "full" and leaves value null.
  return r.value === null && r.status === "full";
}

/**
 * Forecasts one resource from its readings.
 * @param resource  Which resource this is (so the result is labeled even with no readings).
 * @param readings  That resource's NormalizedReadings, sorted by date, all on or before "as of".
 * @returns         A Forecast; any value we can't compute with certainty is null with a reason.
 */
export function forecastResource(resource: Resource, readings: NormalizedReading[]): Forecast {
  // findLastIndex: the index of the last element that passes the test, or -1.
  const latestIdx = readings.findLastIndex((r) => r.value !== null);
  if (latestIdx === -1) {
    return { resource, latest: null, first: null, rate_per_day: null, days_to_empty: null, points_used: 0, reason: "no numeric readings" };
  }
  const latest = readings[latestIdx];

  // Step 2: walk backwards from the latest reading and build the post-refill window.
  const window: NormalizedReading[] = [latest];
  let stoppedBecause: string | null = null;
  for (let i = latestIdx - 1; i >= 0; i--) {
    const r = readings[i];
    if (saysFullWithoutNumber(r)) { stoppedBecause = `refilled on ${r.date} ("${r.raw_text}")`; break; }
    if (r.value === null) continue; // no number that day (e.g. "less than ¾"): skip as missing
    if (comparableValue(r, window[0]) === null) {
      stoppedBecause = `readings before ${window[0].date} are measured differently ("${r.raw_text}")`;
      break;
    }
    if (isRefill(r, window[0])) { stoppedBecause = `refilled on ${window[0].date}`; break; }
    window.unshift(r); // unshift adds to the front, keeping the window in date order
  }

  const base = { resource, latest, first: window[0], points_used: window.length };
  if (window.length < MIN_POINTS_FOR_FORECAST) {
    const why = stoppedBecause ? ` (${stoppedBecause})` : "";
    return { ...base, rate_per_day: null, days_to_empty: null, reason: `only ${window.length} comparable reading${why}` };
  }

  // Step 3: average change per day across the window.
  const first = window[0];
  const days = daysBetween(first.date, latest.date);
  // amountChange is non-null here (the window only holds comparable readings); `!` tells TypeScript so.
  const rate = amountChange(first, latest)! / days;

  // Step 4: days to empty only when 0 really means empty.
  if (latest.unit === "percent" || latest.measured_from === "bottom") {
    if (rate >= 0) return { ...base, rate_per_day: rate, days_to_empty: null, reason: "level is not falling" };
    return { ...base, rate_per_day: rate, days_to_empty: latest.value! / -rate, reason: null };
  }
  const reason =
    latest.measured_from === "top"
      ? "depth measured from the top: without the tank's total depth, 'empty' is undefined (trend only)"
      : "reading doesn't say whether it is measured from the top or the bottom of the tank";
  return { ...base, rate_per_day: rate, days_to_empty: null, reason };
}
