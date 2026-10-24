// analyze.ts — analyzeCrew(): the single source of truth for everything the UI shows.
//
// How it fits: give it every saved extraction for a crew (already in memory) and an "as of" date;
// it returns one Analysis object: today's readings, a chart-ready series per resource, forecasts,
// flags, and today's events and questions. The CLI (scripts/analyze.ts) and the future UI both call
// this same function, so they can never disagree. An uploaded report is just one more extraction
// appended to the list.
//
// Pure and browser-safe: no file, network or clock access. Same inputs → same Analysis.

import type { Resource, SavedExtraction, VerifiedEvent, VerifiedQuestion } from "./schema.ts";
import { ReadingSchema } from "./schema.ts";
import { normalizeExtraction, type NormalizedReading } from "./normalize.ts";
import { amountChange, forecastResource, isRefill, saysFullWithoutNumber, type Forecast } from "./forecast.ts";
import { computeFlags, type Flag, type ResourceSeries, type SeriesPoint } from "./flags.ts";
import { daysBetween } from "./dates.ts";

// Re-exported so the UI can import every type it needs from this one file.
export type { Flag, Forecast, NormalizedReading, ResourceSeries, SeriesPoint };

export type Analysis = {
  asOf: string;
  reportCount: number; // reports dated on or before asOf
  latestReportDate: string | null; // the report "today" refers to (asOf, or the last report before it)
  latestReadings: NormalizedReading[];
  series: ResourceSeries[]; // one entry per resource (except "other"), one point per report day
  forecasts: Forecast[];
  flags: Flag[]; // sorted by severity
  events: VerifiedEvent[]; // from the latest report, with verification status
  questions: VerifiedQuestion[]; // from the latest report, with verification status
};

// "other" lumps unrelated items (e.g. a water well and a generator gauge) under one name, so a
// single series or forecast for it would mix apples and oranges. Its readings still appear in
// latestReadings so nothing is hidden.
const TRACKED: Resource[] = ReadingSchema.shape.resource.options.filter((r) => r !== "other");

/**
 * Picks the one reading of a resource to plot for a day: the first with a usable number, else the
 * first at all (so "less than ¾" still shows up as a null point with its raw text).
 */
function pickReading(readings: NormalizedReading[], resource: Resource): NormalizedReading | undefined {
  const mine = readings.filter((r) => r.resource === resource);
  return mine.find((r) => r.value !== null) ?? mine[0];
}

/**
 * Builds one resource's chart series: one point per report day.
 * @param days  [date, that day's normalized readings] for every report, oldest first.
 * @returns     The points, plus the day-picked readings (in order) that the forecast uses.
 */
function buildSeries(
  resource: Resource,
  days: [string, NormalizedReading[]][],
): { points: SeriesPoint[]; picked: NormalizedReading[] } {
  const points: SeriesPoint[] = [];
  const picked: NormalizedReading[] = [];
  let prevWithValue: NormalizedReading | null = null; // last reading that had a number
  let prevPicked: NormalizedReading | null = null; // last reading of this resource at all
  for (const [date, readings] of days) {
    const r = pickReading(readings, resource);
    if (!r) {
      // Resource not mentioned that day: an empty point keeps the x-axis one-point-per-day.
      points.push({ date, value: null, unit: null, measured_from: null, raw_text: null, source_quote: null, change_from_previous: null, change_per_day: null, refill: false });
      continue;
    }
    const change = prevWithValue ? amountChange(prevWithValue, r) : null;
    const gap = prevWithValue ? daysBetween(prevWithValue.date, date) : 0; // days since that reading
    // A refill is either a big enough rise, or the crew writing "Full" where we have no number.
    const refill =
      (prevWithValue !== null && isRefill(prevWithValue, r)) ||
      (saysFullWithoutNumber(r) && !(prevPicked && saysFullWithoutNumber(prevPicked)));
    points.push({
      date,
      value: r.value,
      unit: r.unit,
      measured_from: r.measured_from,
      raw_text: r.raw_text,
      source_quote: r.source_quote,
      change_from_previous: change,
      change_per_day: change !== null && gap > 0 ? change / gap : null,
      refill,
    });
    picked.push(r);
    prevPicked = r;
    if (r.value !== null) prevWithValue = r;
    // After a "Full" with no number, the next numbered reading isn't comparable to what came before.
    if (saysFullWithoutNumber(r)) prevWithValue = null;
  }
  return { points, picked };
}

/**
 * Analyzes a crew's reports as they stood on `asOf`.
 * @param extractions  Every saved extraction for the crew, in any order (later duplicates of a date win).
 * @param asOf         YYYY-MM-DD. Reports dated after this are ignored — no looking ahead.
 * @returns            The Analysis the CLI prints and the UI renders.
 */
export function analyzeCrew(extractions: SavedExtraction[], asOf: string): Analysis {
  // A Map keyed by date keeps one report per day; set() on an existing key replaces it, so a
  // re-uploaded report for the same date wins. ISO dates compare correctly as strings.
  const byDate = new Map<string, SavedExtraction>();
  for (const x of extractions) if (x.date <= asOf) byDate.set(x.date, x);
  const reports = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  const latest = reports.at(-1); // .at(-1) = last element, or undefined if the list is empty
  if (!latest) {
    return { asOf, reportCount: 0, latestReportDate: null, latestReadings: [], series: [], forecasts: [], flags: [], events: [], questions: [] };
  }

  // Normalize every report once; `days` pairs each date with its readings for buildSeries.
  const days: [string, NormalizedReading[]][] = reports.map((x) => [x.date, normalizeExtraction(x)]);
  const latestReadings = days.at(-1)![1];

  // Only resources the crew has actually reported get a series and a forecast.
  const reported = TRACKED.filter((res) => days.some(([, rs]) => rs.some((r) => r.resource === res)));
  const series: ResourceSeries[] = [];
  const forecasts: Forecast[] = [];
  for (const resource of reported) {
    const { points, picked } = buildSeries(resource, days);
    series.push({ resource, points });
    forecasts.push(forecastResource(resource, picked));
  }

  const flags = computeFlags({
    latestReport: latest,
    latestReadings,
    earlierReports: reports.slice(0, -1),
    series,
    forecasts,
  });

  return {
    asOf,
    reportCount: reports.length,
    latestReportDate: latest.date,
    latestReadings,
    series,
    forecasts,
    flags,
    events: latest.events,
    questions: latest.questions_to_mission_support,
  };
}
