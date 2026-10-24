// flags.ts — the deterministic alert rules. Every alert the crew or Earth sees comes from here.
//
// How it fits: analyze.ts builds the readings, series and forecasts, then calls computeFlags() with
// them. Each rule is a small, plain check against a threshold in constants.ts. Gemini's event `type`
// labels are never used to decide anything (CLAUDE.md: alerts come from our rules, not the LLM);
// event severity comes from keyword rules applied to the VERIFIED quote the crew actually wrote.
// Every flag carries `evidence`: the report quotes that justify it. Browser-safe.

import type { NormalizedReading } from "./normalize.ts";
import type { Forecast } from "./forecast.ts";
import type { Resource, SavedExtraction } from "./schema.ts";
import { daysBetween } from "./dates.ts";
import {
  CRITICAL_EVENT_KEYWORDS,
  LOW_LEVEL_PERCENT,
  MIN_DROPS_FOR_SPIKE,
  MISSION_END_DATE,
  USAGE_SPIKE_MULTIPLIER,
  WARNING_EVENT_KEYWORDS,
} from "./constants.ts";

export type Severity = "critical" | "warning" | "info";

export type Flag = {
  type:
    | "LOW_LEVEL"
    | "RUNS_OUT_BEFORE_MISSION_END"
    | "USAGE_SPIKE"
    | "MISSING_READING"
    | "UNVERIFIED_QUOTE"
    | "CREW_REPORTED_EVENT";
  severity: Severity;
  resource: Resource | null; // null for flags not tied to one resource (events, questions)
  message: string;
  evidence: string[]; // source_quotes from the reports
};

// One point of a resource's time series (built by analyze.ts). Defined here, not in analyze.ts,
// so flags.ts doesn't import analyze.ts (which imports flags.ts) — avoiding a circular import.
export type SeriesPoint = {
  date: string;
  value: number | null; // as normalized; null if no usable reading that day
  unit: NormalizedReading["unit"];
  measured_from: NormalizedReading["measured_from"];
  raw_text: string | null; // what the crew wrote that day (null = resource not mentioned)
  source_quote: string | null;
  change_from_previous: number | null; // amount change vs the previous comparable reading (negative = used up)
  change_per_day: number | null; // change_from_previous ÷ days since that reading
  refill: boolean;
};
export type ResourceSeries = { resource: Resource; points: SeriesPoint[] };

export type FlagInput = {
  latestReport: SavedExtraction; // the report for the as-of day (or the latest before it)
  latestReadings: NormalizedReading[]; // its readings, normalized
  earlierReports: SavedExtraction[]; // every report before it, oldest first
  series: ResourceSeries[];
  forecasts: Forecast[];
};

/** Formats a number for a message: at most 1 decimal, no trailing ".0". */
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Median of a non-empty list: middle value after sorting (average of the two middles if even). */
function median(xs: number[]): number {
  // [...xs] copies before sorting (sort mutates); (a, b) => a - b sorts numbers numerically, not as text.
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Decides how serious a crew-reported event is from the words in its verified quote.
 * Why it exists: severity must come from our rules (constants.ts), not from Gemini's label.
 */
function eventSeverity(quote: string): Severity {
  const q = quote.toLowerCase();
  if (CRITICAL_EVENT_KEYWORDS.some((k) => q.includes(k))) return "critical";
  if (WARNING_EVENT_KEYWORDS.some((k) => q.includes(k))) return "warning";
  return "info";
}

/** LOW_LEVEL: a percent reading today below LOW_LEVEL_PERCENT. */
function lowLevelFlags(readings: NormalizedReading[]): Flag[] {
  return readings
    .filter((r) => r.unit === "percent" && r.value !== null && r.value < LOW_LEVEL_PERCENT)
    .map((r) => ({
      type: "LOW_LEVEL",
      severity: "warning",
      resource: r.resource,
      message: `${r.resource} is at ${fmt(r.value!)}% (below our ${LOW_LEVEL_PERCENT}% threshold)`,
      evidence: [r.source_quote],
    }));
}

/** RUNS_OUT_BEFORE_MISSION_END: forecast says empty before MISSION_END_DATE. */
function runsOutFlags(forecasts: Forecast[]): Flag[] {
  const flags: Flag[] = [];
  for (const f of forecasts) {
    if (f.days_to_empty === null || f.latest === null || f.first === null) continue;
    const daysLeft = daysBetween(f.latest.date, MISSION_END_DATE); // counted from the same day as the forecast
    if (f.days_to_empty >= daysLeft) continue;
    flags.push({
      type: "RUNS_OUT_BEFORE_MISSION_END",
      severity: "critical",
      resource: f.resource,
      message:
        `${f.resource} empty in ~${fmt(f.days_to_empty)} days at ${fmt(f.rate_per_day!)} ${f.latest.unit}/day, ` +
        `before mission end ${MISSION_END_DATE} (${daysLeft} days away) — based on ${f.points_used} readings`,
      // Both ends of the rate, so a reader can check the arithmetic.
      evidence: [f.first.source_quote, f.latest.source_quote],
    });
  }
  return flags;
}

/** USAGE_SPIKE: today's per-day drop is more than USAGE_SPIKE_MULTIPLIER × the median earlier drop. */
function spikeFlags(series: ResourceSeries[], today: string): Flag[] {
  const flags: Flag[] = [];
  for (const { resource, points } of series) {
    const last = points[points.length - 1];
    if (!last || last.date !== today || last.change_per_day === null || last.change_per_day >= 0) continue;
    // Earlier drops only (not refills, not today), as positive sizes.
    const earlier = points
      .slice(0, -1) // slice(0, -1) = every point except the last
      .filter((p) => p.change_per_day !== null && p.change_per_day < 0)
      .map((p) => -p.change_per_day!);
    if (earlier.length < MIN_DROPS_FOR_SPIKE) continue; // too little history for a median to mean anything
    const typical = median(earlier);
    const drop = -last.change_per_day;
    if (drop <= USAGE_SPIKE_MULTIPLIER * typical) continue;
    flags.push({
      type: "USAGE_SPIKE",
      severity: "warning",
      resource,
      message: `${resource} dropped ${fmt(drop)} ${last.unit}/day, more than ${USAGE_SPIKE_MULTIPLIER}× its median drop of ${fmt(typical)}/day`,
      evidence: last.source_quote ? [last.source_quote] : [],
    });
  }
  return flags;
}

/** MISSING_READING: a resource reported in an earlier report is absent from today's. */
function missingFlags(latestReport: SavedExtraction, earlierReports: SavedExtraction[]): Flag[] {
  const today = new Set(latestReport.readings.map((r) => r.resource)); // Set = fast "is it in here?" lookups
  const previous = new Set(earlierReports.at(-1)?.readings.map((r) => r.resource) ?? []); // .at(-1) = last item
  const seen = new Set(earlierReports.flatMap((x) => x.readings.map((r) => r.resource)));
  const flags: Flag[] = [];
  for (const resource of seen) {
    // "other" lumps unrelated items together, so "other is missing" would mean nothing.
    if (resource === "other" || today.has(resource)) continue;
    // Newly missing (was in the previous report) is a warning; long-absent is just info.
    const newlyMissing = previous.has(resource);
    const lastSeen = earlierReports.findLast((x) => x.readings.some((r) => r.resource === resource))!;
    flags.push({
      type: "MISSING_READING",
      severity: newlyMissing ? "warning" : "info",
      resource,
      message: `no ${resource} reading on ${latestReport.date} (last reported ${lastSeen.date})`,
      evidence: lastSeen.readings.filter((r) => r.resource === resource).map((r) => r.source_quote),
    });
  }
  return flags;
}

/** UNVERIFIED_QUOTE: any reading, event or question in today's report whose quote isn't in the report. */
function unverifiedFlags(report: SavedExtraction): Flag[] {
  const items = [
    // Each item becomes { what, resource, verified, source_quote } so one filter/map handles all three kinds.
    // `as Resource | null` widens the readings' type so all three lists share one element type.
    ...report.readings.map((r) => ({ what: `${r.resource} reading "${r.raw_text}"`, resource: r.resource as Resource | null, verified: r.verified, source_quote: r.source_quote })),
    ...report.events.map((e) => ({ what: `event "${e.description}"`, resource: null, verified: e.verified, source_quote: e.source_quote })),
    ...report.questions_to_mission_support.map((q) => ({ what: `question "${q.text}"`, resource: null, verified: q.verified, source_quote: q.source_quote })),
  ];
  return items
    .filter((i) => !i.verified)
    .map((i) => ({
      type: "UNVERIFIED_QUOTE",
      severity: "warning",
      resource: i.resource,
      message: `${i.what}: its quote was not found verbatim in the report, so it is not used`,
      evidence: [i.source_quote],
    }));
}

/** CREW_REPORTED_EVENT: every event in today's report, with severity from our keyword rules. */
function eventFlags(report: SavedExtraction): Flag[] {
  return report.events.map((e) => ({
    type: "CREW_REPORTED_EVENT",
    // An unverified quote can't be trusted to set severity; it also gets an UNVERIFIED_QUOTE flag.
    severity: e.verified ? eventSeverity(e.source_quote) : "info",
    resource: null,
    message: `crew reported: ${e.description}`,
    evidence: [e.source_quote],
  }));
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Runs every rule and returns all flags, most severe first.
 * @param input  The as-of report, its normalized readings, earlier reports, series and forecasts.
 * @returns      Flags sorted critical → warning → info (original order kept within a severity).
 */
export function computeFlags(input: FlagInput): Flag[] {
  const all: Flag[] = [
    ...eventFlags(input.latestReport),
    ...runsOutFlags(input.forecasts),
    ...lowLevelFlags(input.latestReadings),
    ...spikeFlags(input.series, input.latestReport.date),
    ...missingFlags(input.latestReport, input.earlierReports),
    ...unverifiedFlags(input.latestReport),
  ];
  // Array sort is stable in modern JS, so equal severities keep the order above.
  return all.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
