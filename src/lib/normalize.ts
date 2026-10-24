// normalize.ts — converts each extracted reading into one standard unit per resource, or null with
// a human-readable reason. Our code does this, never Gemini (CLAUDE.md: deterministic code does math).
//
// How it fits: analyze.ts runs normalizeExtraction() on every saved report; forecast.ts and flags.ts
// only ever see NormalizedReadings. We parse `raw_text` ourselves and ignore Gemini's `value`/`unit`
// guesses, so the numbers come from what the crew wrote, by rules we can test. Browser-safe.
//
// Formats found in the Crew 147 survey (data/extractions/crew-147-survey.md) and the rule for each.
// The survey covers Jan 12–19 (8 of 11 reports); Jan 21–23 weren't extracted yet (Gemini quota).
// Their raw text uses the same forms ("55%", "38 cm from the top"), which these rules already cover.
//   diesel        "¾"                      → 75 percent (exact fraction)
//                 "less than ¾"            → null: a bound, not a level
//                 "60%", "55%", "50%"      → that percent
//   propane       "45%" … "30%"            → that percent (the only format used)
//   gasoline      never given as a level   → no readings ("Two tanks of gasoline were delivered" is not a level)
//   water_static  "15cm" (Jan 13–14)       → 15 cm, measured_from null (report doesn't say top/bottom)
//                 "Less than 10cm"/"10 cm" → null: a bound, not a level
//                 "Full" (Jan 17)          → status "full", value null: the tank's capacity in cm isn't
//                                            given; forecast.ts and analyze.ts treat it as a refill marker
//                 "13 cm from the top" …   → 13 cm, measured_from "top" (from the quote's wording)
//                 "¼" quoted as "Water well ¼" (Jan 12) → null: the quote never names the static
//                                            tank, so Gemini's tank label is unconfirmed
//                 "85"/"95" (Jan 17 refill form, no unit) → null: no unit stated
//   water_loft    "25"/"50" (Jan 17 form, no unit) → null: no unit stated. Otherwise only "filled".
//   water_trailer "140"/"15" (Jan 17 form, no unit) → null: no unit stated
//   other         "5 bags" (trash), water-meter numbers with no unit → null: not a tracked unit
// Commander reports (Phase 3a decisions by Malek):
//   water_total   "~360l" (Jan 13)         → 360 L with approximate: true (estimates are kept and labeled)
//   water_static/water_loft "empty", "half-empty", "full" (Jan 16–17) → status "empty"/"half"/"full",
//                                            value null (a tank state, not a measured level)
//
// General rules: unverified quote → null. raw_text must appear inside its own source_quote, or null.
// Approximate: a leading "~", "about", "approx", "around" or "roughly" is stripped and the rest parsed;
// the reading is marked approximate (also when Gemini set approximate: true). Bounds ("less than") stay null.
// Status words apply to every resource, fuels included: "full" is a state, not a number we measured.
// measured_from comes from the quote's words ("from the top"/"from the bottom"), not Gemini's field.
// Water levels keep the crew's unit; in↔cm and L↔gal only convert with the exact constants below,
// and tank levels are never turned into volumes (no report gives a tank capacity).

import type { Resource, SavedExtraction, VerifiedReading } from "./schema.ts";

export type NormalizedUnit = "percent" | "cm" | "in" | "gal" | "L";

// A tank state the crew wrote as a word instead of a level ("the static tank is empty").
export type TankStatus = "empty" | "half" | "full";

export type NormalizedReading = {
  date: string; // YYYY-MM-DD of the report
  resource: Resource;
  value: number | null; // in `unit`; null whenever we can't be certain (see reason)
  unit: NormalizedUnit | null;
  measured_from: "top" | "bottom" | null; // for depths; null if the report doesn't say
  approximate: boolean; // true if the crew marked it as an estimate ("~360l"); the UI labels it
  status: TankStatus | null; // set when the crew wrote a state word; value is then null
  report_kind: string; // which report it came from: "engineering", "commander", ...
  raw_text: string; // exactly as extracted
  source_quote: string; // exactly as extracted
  verified: boolean; // did source_quote appear verbatim in the report?
  reason: string | null; // why value is null, or a caveat about it
};

// Exact by definition: 1 inch = 2.54 cm (international inch, 1959); 1 US gallon = 3.785411784 L.
const CM_PER_INCH = 2.54;
const LITERS_PER_US_GALLON = 3.785411784;

const FUELS: Resource[] = ["diesel", "propane", "gasoline"];

// The word each water tank's quote must contain before we trust Gemini's label for it.
// Regex /static/i: the letters "static", any case.
const TANK_NAME: Partial<Record<Resource, RegExp>> = {
  water_static: /static/i,
  water_loft: /loft/i,
  water_trailer: /trailer/i,
};

// Unicode vulgar fractions the crew might type, as exact percentages.
const UNICODE_FRACTIONS: Record<string, number> = { "¼": 25, "½": 50, "¾": 75 };

// State words (whole raw_text, lowercased) → status. Anything vaguer ("low", "filled") → null.
const STATUS_WORDS: Record<string, TankStatus> = { empty: "empty", half: "half", "half-empty": "half", full: "full" };

// Regex: at the start (^), one estimate marker — "~", "about", "approx", "approx.", "approximately",
// "around" or "roughly" — then any spaces. `i` = any case. Matching text is stripped before parsing.
const APPROX_MARKER = /^(~|about|approximately|approx\.?|around|roughly)\s*/i;

/**
 * Converts a value between units when an exact constant exists.
 * @returns  The converted value, or null if the units measure different things (e.g. cm vs gal).
 * Why it exists: forecast.ts compares readings that may be written in different units.
 */
export function convertValue(value: number, from: NormalizedUnit, to: NormalizedUnit): number | null {
  if (from === to) return value;
  if (from === "in" && to === "cm") return value * CM_PER_INCH;
  if (from === "cm" && to === "in") return value / CM_PER_INCH;
  if (from === "gal" && to === "L") return value * LITERS_PER_US_GALLON;
  if (from === "L" && to === "gal") return value / LITERS_PER_US_GALLON;
  return null;
}

/** Collapses whitespace runs to one space and trims (same idea as verify.ts). */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Parses a gauge-style level ("40%", "¾", "3/4") into a percent.
 * @returns  The percent, or null if the text isn't exactly one of those forms.
 */
export function parsePercent(raw: string): number | null {
  const s = squash(raw);
  // Regex: optional digits with optional decimals, optional space, then "%", nothing else.
  const pct = s.match(/^(\d+(?:\.\d+)?) ?%$/);
  if (pct) return Number(pct[1]);
  if (s in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[s]; // `in` checks the object has that key
  // ASCII fraction like "3/4": numerator / denominator × 100.
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac && Number(frac[2]) > 0) return (Number(frac[1]) / Number(frac[2])) * 100;
  return null;
}

/**
 * Parses a depth or volume like "15cm", "13 cm", "4 in", "20 gal", "75 L".
 * @returns  { value, unit }, or null if there is no number + recognized unit.
 */
export function parseMeasure(raw: string): { value: number; unit: NormalizedUnit } | null {
  // Regex: number, optional space, then a unit word (case-insensitive via the `i` flag).
  const m = squash(raw).match(/^(\d+(?:\.\d+)?) ?(cm|in|inches|gal|gallons|l|liters|litres)$/i);
  if (!m) return null;
  const word = m[2].toLowerCase();
  const unit: NormalizedUnit =
    word === "cm" ? "cm" : word.startsWith("in") ? "in" : word.startsWith("gal") ? "gal" : "L";
  return { value: Number(m[1]), unit };
}

/**
 * Reads the report kind from a saved report's filename: "2015-01-13-commander.txt" → "commander".
 * @returns  The kind, or "unknown" if the filename isn't "YYYY-MM-DD-<kind>.txt".
 * Why it exists: analyze.ts merges a day's engineering and commander reports and tags every quote
 * with the kind it came from. Lives here (not in scripts/) so the browser can use it too.
 */
export function reportKindOf(file: string): string {
  // Regex: skip the date and dash, capture the letters before ".txt".
  return file.match(/^\d{4}-\d{2}-\d{2}-([a-z]+)\.txt$/)?.[1] ?? "unknown"; // ?.[1] = capture group, if matched
}

/**
 * Explains why text that isn't a level was rejected, in words a crew member would understand.
 */
function rejectReason(raw: string): string {
  // Regex: any of these hedging words anywhere in the text means "a bound or estimate, not a level".
  if (/less than|more than|under|over|</i.test(raw)) return `"${squash(raw)}" is a bound, not a level`;
  if (APPROX_MARKER.test(squash(raw))) return `"${squash(raw)}" is an estimate we can't convert`;
  if (/^\s*\d+(\.\d+)?\s*$/.test(raw)) return `"${squash(raw)}" has no unit`;
  return `"${squash(raw)}" is not a level we can convert exactly`;
}

/**
 * Normalizes one verified reading.
 * @param r     A reading from a saved extraction (with its verified flag).
 * @param date  The report's YYYY-MM-DD date.
 * @param reportKind  Which report it came from ("engineering", "commander", ...).
 * @returns     A NormalizedReading; value is null (with a reason) unless we parsed it from the crew's text.
 */
export function normalizeReading(r: VerifiedReading, date: string, reportKind: string): NormalizedReading {
  // measured_from from the crew's own words. Regex /from the top/i = that phrase, any case.
  const quoteSays = /from the top/i.test(r.source_quote) ? "top" : /from the bottom/i.test(r.source_quote) ? "bottom" : null;
  const out: NormalizedReading = {
    date,
    resource: r.resource,
    value: null,
    unit: null,
    measured_from: quoteSays,
    approximate: false, // set below once we know the text parsed
    status: null,
    report_kind: reportKind,
    raw_text: r.raw_text,
    source_quote: r.source_quote,
    verified: r.verified,
    reason: null,
  };
  const nullBecause = (reason: string): NormalizedReading => ({ ...out, reason });

  if (!r.verified) return nullBecause("source quote not found verbatim in the report");
  if (!squash(r.source_quote).includes(squash(r.raw_text))) return nullBecause("raw_text does not appear in its own quote");
  const tank = TANK_NAME[r.resource];
  if (tank && !tank.test(r.source_quote)) {
    return nullBecause(`quote "${squash(r.source_quote)}" doesn't name this tank; Gemini's label is unconfirmed`);
  }

  // A state word: keep it as a status, never turn it into a number (Malek's decision 2).
  const status = STATUS_WORDS[squash(r.raw_text).toLowerCase()];
  if (status) return { ...out, status, reason: `"${squash(r.raw_text)}" is a tank state, not a measured level` };

  // Strip a leading estimate marker ("~360l" → "360l") and remember that we did.
  const text = squash(r.raw_text).replace(APPROX_MARKER, "");
  // Gemini's flag is a second signal; `=== true` because older saved files don't have the field.
  const approximate = text !== squash(r.raw_text) || r.approximate === true;

  if (FUELS.includes(r.resource)) {
    const pct = parsePercent(text);
    return pct === null ? nullBecause(rejectReason(r.raw_text)) : { ...out, value: pct, unit: "percent", approximate };
  }

  // Water tanks and "other": a measured depth/volume, or a gauge percent.
  const measure = parseMeasure(text);
  if (measure) return { ...out, ...measure, approximate };
  const pct = parsePercent(text);
  if (pct !== null) return { ...out, value: pct, unit: "percent", approximate };
  return nullBecause(rejectReason(r.raw_text));
}

/** Normalizes every reading in one saved report, tagging each with the report's kind. */
export function normalizeExtraction(x: SavedExtraction): NormalizedReading[] {
  const kind = reportKindOf(x.source_file);
  return x.readings.map((r) => normalizeReading(r, x.date, kind));
}
