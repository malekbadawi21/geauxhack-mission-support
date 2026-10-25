// format.ts — turns analysis values into the short text the dashboard shows.
//
// How it fits: components never format numbers or dates themselves; they call these helpers so
// "75 %", "~360 L" and "Jan 13" look the same everywhere. Display only: rounding here is for reading,
// the analysis keeps the full values. Also holds the quote-verification lookup the flags and report
// panels share, and which flags go in the critical-alert dialog. Browser-safe.

import type { Resource, SavedExtraction } from "../lib/schema.ts";
import type { NormalizedUnit } from "../lib/normalize.ts";
import type { Flag, SeriesPoint } from "../lib/analyze.ts";

// Readable names for the flag types (the raw type stays visible in the flag id). Shared by the Flags
// table and the critical-alert dialog, so both title a flag the same way.
export const TYPE_LABEL: Record<Flag["type"], string> = {
  TANK_EMPTY_REPORTED: "Tank reported empty",
  LOW_LEVEL: "Low level",
  RUNS_OUT_BEFORE_MISSION_END: "Runs out before mission end",
  USAGE_SPIKE: "Usage spike",
  MISSING_READING: "Missing reading",
  UNVERIFIED_QUOTE: "Unverified quote",
  CREW_REPORTED_EVENT: "Crew-reported event",
};

// Plain-English names for each resource, as the crew would say them.
export const RESOURCE_LABEL: Record<Resource, string> = {
  diesel: "Diesel",
  propane: "Propane",
  water_static: "Static water tank",
  water_loft: "Loft water tank",
  water_trailer: "Trailer water tank",
  gasoline: "Gasoline",
  water_total: "Water on hand",
  other: "Other",
};

// Display order for charts: the four headline resources first, then anything else reported.
export const RESOURCE_ORDER: Resource[] = ["diesel", "propane", "water_static", "water_total", "water_loft", "water_trailer", "gasoline"];

// How each unit is written after a number.
const UNIT_TEXT: Record<NormalizedUnit, string> = { percent: "%", cm: "cm", in: "in", gal: "gal", L: "L" };

/** Unit text for a number, e.g. "percent" → "%"; empty string when the unit is unknown. */
export const unitText = (u: NormalizedUnit | null) => (u ? UNIT_TEXT[u] : "");

/**
 * Formats a number for display: at most `digits` decimals, no trailing zeros, minus sign as "−".
 * Why the real minus sign: it is the same width as a digit in tabular figures, so columns line up.
 */
export function num(n: number, digits = 1): string {
  // toFixed rounds to `digits` decimals; Number() then drops trailing zeros ("8.0" → 8).
  const s = String(Number(n.toFixed(digits)));
  return s.replace("-", "−");
}

/**
 * Formats a range low–high ("4.4–5.4"), or one number when both round to the same text.
 * Why it exists: the water panel and card show one figure per reference rate as a single range.
 */
export function numRange(a: number, b: number, digits = 1): string {
  const [lo, hi] = [Math.min(a, b), Math.max(a, b)].map((x) => num(x, digits)); // destructure the two formatted ends
  return lo === hi ? lo : `${lo}–${hi}`;
}

// Month abbreviations; dates are YYYY-MM-DD strings, so we format them without Date (no time zones).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2015-01-13" → "Jan 13". */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-"); // destructuring skips the year with the leading comma
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "2015-01-13" → "Jan 13, 2015". */
export const longDate = (iso: string) => `${shortDate(iso)}, ${iso.slice(0, 4)}`;

/**
 * The value of one chart point as text: "~360 L", "13 cm from top", "FULL", or null if nothing usable.
 * Why it exists: cards, tooltips and the water panel must label approximate and state readings the same way.
 */
export function pointValueText(p: Pick<SeriesPoint, "value" | "unit" | "approximate" | "status" | "measured_from">): string | null {
  if (p.value !== null) {
    const approx = p.approximate ? "~" : "";
    const from = p.measured_from ? ` from ${p.measured_from}` : "";
    return `${approx}${num(p.value)} ${unitText(p.unit)}${from}`;
  }
  if (p.status) return p.status.toUpperCase();
  return null;
}

/**
 * Was this quote found verbatim in a report of this kind?
 * @param received  The extractions currently loaded (each item carries its `verified` flag from verify.ts).
 * @returns         true / false from verify.ts, or null if no loaded item has this quote.
 * Why it exists: Flag evidence holds only the quote and report kind, but the UI must mark each quote
 * as verified or not, so we look the quote up in the reports it came from.
 */
export function quoteVerified(received: SavedExtraction[], reportKind: string, quote: string): boolean | null {
  let found: boolean | null = null;
  for (const x of received) {
    if (!x.source_file.includes(`-${reportKind}.`)) continue; // only reports of the same kind
    for (const item of [...x.readings, ...x.events, ...x.questions_to_mission_support]) {
      if (item.source_quote !== quote) continue;
      if (item.verified) return true; // one verified match is enough
      found = false;
    }
  }
  return found;
}

/**
 * A flag message for display: resource ids ("water_static") become their names ("static water tank").
 * Why it exists: flags.ts writes ids, which the agent needs to match data; people need names (Q6).
 */
export function readableMessage(message: string): string {
  // Each id is matched as a whole word (\b) so "water_total" never matches inside another word.
  return (Object.keys(RESOURCE_LABEL) as Resource[]).reduce(
    (text, id) => text.replace(new RegExp(`\\b${id}\\b`, "g"), RESOURCE_LABEL[id].toLowerCase()),
    message,
  );
}

/** The HTML id each flag row gets, so the daily report's concern links can scroll to it. */
export const flagAnchor = (id: string) => `flag-${id}`;

/**
 * Which flags go in the critical-alert dialog: the critical ones not acknowledged yet, in the order given.
 * Why it exists: the rule is small but it decides when the crew is interrupted, so it is tested.
 */
export function flagsForAlert(flags: Flag[], acknowledged: Set<string>): Flag[] {
  return flags.filter((f) => f.severity === "critical" && !acknowledged.has(f.id));
}
