// analyze.ts — analyzeCrew(): the single source of truth for everything the UI shows.
//
// How it fits: give it every saved extraction for a crew (already in memory), an "as of" date and
// the crew's config; it returns one Analysis object: today's readings, a chart-ready series per
// resource, forecasts, flags, water scenarios, and today's events and questions. The CLI
// (scripts/analyze.ts), the agent (Phase 3b) and the UI all call this same function, so they can
// never disagree. An uploaded report is just one more extraction appended to the list.
//
// One day can have several reports (engineering + commander). They are merged into one ReportDay:
//   - readings: all kept, engineering first. For the chart, the first USABLE reading (a number or a
//     state word) of each resource wins, so the engineer's measurement beats the commander's, and
//     the commander fills resources the engineer didn't give (e.g. water_total "~360l").
//   - every quote about a resource that day stays as evidence, tagged with its report kind.
//   - events and questions: the union of both reports, each tagged with its report kind.
//
// The Analysis type is FROZEN as of Phase 3a: Phase 3b (agent) and Phase 4 (UI) build against it.
// Pure and browser-safe: no file, network or clock access. Same inputs → same Analysis.

import type { Resource, SavedExtraction, VerifiedEvent, VerifiedQuestion } from "./schema.ts";
import { ReadingSchema } from "./schema.ts";
import { normalizeExtraction, reportKindOf, type NormalizedReading, type TankStatus } from "./normalize.ts";
import { amountChange, forecastResource, isRefill, saysFullWithoutNumber, type Forecast } from "./forecast.ts";
import {
  computeFlags,
  type Evidence,
  type Flag,
  type ReportDay,
  type ResourceSeries,
  type SeriesPoint,
  type Tagged,
} from "./flags.ts";
import { waterScenarios, type WaterScenario, type WaterScenarios } from "./water.ts";
import type { CrewConfig } from "./constants.ts";
import { daysBetween } from "./dates.ts";

// Re-exported so the UI can import every type it needs from this one file.
export type {
  CrewConfig,
  Evidence,
  Flag,
  Forecast,
  NormalizedReading,
  ReportDay,
  ResourceSeries,
  SeriesPoint,
  Tagged,
  TankStatus,
  WaterScenario,
  WaterScenarios,
};

export type Analysis = {
  asOf: string;
  crew: CrewConfig; // who this is about (from config, never from an extraction)
  reportCount: number; // report files dated on or before asOf (a day can have two)
  latestReportDate: string | null; // the day "today" refers to (asOf, or the last report day before it)
  latestReportKinds: string[]; // which reports exist for that day, e.g. ["engineering", "commander"]
  latestReadings: NormalizedReading[]; // every reading from that day's reports, engineering first
  series: ResourceSeries[]; // one entry per resource (except "other"), one point per report day
  forecasts: Forecast[];
  flags: Flag[]; // sorted by severity; each has a stable id
  events: Tagged<VerifiedEvent>[]; // from that day's reports, with verification status
  questions: Tagged<VerifiedQuestion>[]; // from that day's reports, with verification status
  waterScenarios: WaterScenarios | null; // null when there's no usable water volume (see reason)
  waterScenariosReason: string | null; // why waterScenarios is null; null when it isn't
};

// "other" lumps unrelated items (e.g. a water well and a generator gauge) under one name, so a
// single series or forecast for it would mix apples and oranges. Its readings still appear in
// latestReadings so nothing is hidden.
const TRACKED: Resource[] = ReadingSchema.shape.resource.options.filter((r) => r !== "other");

// Merge order within a day: engineering first (the engineer measured it), then commander, then
// anything else. Earlier kinds win when two reports give the same resource.
const KIND_ORDER = ["engineering", "commander"];

/** Sort rank of a report kind: its position in KIND_ORDER, unknown kinds last. */
function kindRank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

/**
 * Groups reports by date into ReportDays, merging every report of a day.
 * @param reports  Saved extractions, all on or before asOf, one per (date, kind).
 * @returns        One ReportDay per date, oldest first; within a day, engineering items come first.
 */
function groupByDay(reports: SavedExtraction[]): ReportDay[] {
  // Sort by date, then by kind rank. `||` moves on to the second comparison only when dates tie (0).
  const sorted = [...reports].sort(
    (a, b) => a.date.localeCompare(b.date) || kindRank(reportKindOf(a.source_file)) - kindRank(reportKindOf(b.source_file)),
  );
  const days: ReportDay[] = [];
  for (const x of sorted) {
    const kind = reportKindOf(x.source_file);
    let day = days.at(-1);
    if (!day || day.date !== x.date) {
      day = { date: x.date, report_kinds: [], readings: [], events: [], questions: [] };
      days.push(day);
    }
    day.report_kinds.push(kind);
    day.readings.push(...normalizeExtraction(x)); // normalizeExtraction tags each reading with its kind
    // { ...e, report_kind: kind } copies the item and adds the tag (the saved extraction is not changed).
    day.events.push(...x.events.map((e) => ({ ...e, report_kind: kind })));
    day.questions.push(...x.questions_to_mission_support.map((q) => ({ ...q, report_kind: kind })));
  }
  return days;
}

/**
 * Picks the one reading of a resource to plot for a day: the first with a number or a state word,
 * else the first at all (so "less than ¾" still shows up as a null point with its raw text).
 * Readings are in merge order, so an engineering reading wins over a commander one when both are usable.
 */
function pickReading(readings: NormalizedReading[], resource: Resource): NormalizedReading | undefined {
  const mine = readings.filter((r) => r.resource === resource);
  return mine.find((r) => r.value !== null || r.status !== null) ?? mine[0];
}

/**
 * Builds one resource's chart series: one point per report day.
 * @param days  Every ReportDay up to asOf, oldest first.
 * @returns     The points, plus the day-picked readings (in order) that the forecast uses.
 */
function buildSeries(resource: Resource, days: ReportDay[]): { points: SeriesPoint[]; picked: NormalizedReading[] } {
  const points: SeriesPoint[] = [];
  const picked: NormalizedReading[] = [];
  let prevWithValue: NormalizedReading | null = null; // last reading that had a number
  // True once the tank was reported "empty"/"half" or fell, since the last fill. A "full" after that
  // is a refill; a "full" after another "full" (or with no history) is just the same state again.
  let fellSinceFull = false;
  for (const { date, readings } of days) {
    const r = pickReading(readings, resource);
    if (!r) {
      // Resource not mentioned that day: an empty point keeps the x-axis one-point-per-day.
      points.push({ date, value: null, unit: null, measured_from: null, approximate: false, status: null, raw_text: null, source_quote: null, report_kind: null, evidence: [], change_from_previous: null, change_per_day: null, refill: false });
      continue;
    }
    const change = prevWithValue ? amountChange(prevWithValue, r) : null;
    const gap = prevWithValue ? daysBetween(prevWithValue.date, date) : 0; // days since that reading
    if (r.status === "empty" || r.status === "half" || (change !== null && change < 0)) fellSinceFull = true;
    // A refill is either a big enough rise in level, or the crew writing "full" after it had fallen.
    const jump = prevWithValue !== null && isRefill(prevWithValue, r);
    const refill = jump || (r.status === "full" && fellSinceFull);
    if (refill) fellSinceFull = false;
    points.push({
      date,
      value: r.value,
      unit: r.unit,
      measured_from: r.measured_from,
      approximate: r.approximate,
      status: r.status,
      raw_text: r.raw_text,
      source_quote: r.source_quote,
      report_kind: r.report_kind,
      // Every quote about this resource that day, from every report, so nothing the crew said is hidden.
      evidence: readings.filter((x) => x.resource === resource).map((x) => ({ report_kind: x.report_kind, quote: x.source_quote })),
      change_from_previous: change,
      change_per_day: change !== null && gap > 0 ? change / gap : null,
      refill,
    });
    picked.push(r);
    if (r.value !== null) prevWithValue = r;
    // After a "full" with no number, the next numbered reading isn't comparable to what came before.
    if (saysFullWithoutNumber(r)) prevWithValue = null;
  }
  return { points, picked };
}

/**
 * Analyzes a crew's reports as they stood on `asOf`.
 * @param extractions  Every saved extraction for the crew, any kind, any order (a later duplicate of
 *                     the same date and kind replaces the earlier one).
 * @param asOf         YYYY-MM-DD. Reports dated after this are ignored — no looking ahead.
 * @param crew         The crew's config (size, mission end) from constants.ts.
 * @returns            The Analysis the CLI prints, the agent reads and the UI renders.
 */
export function analyzeCrew(extractions: SavedExtraction[], asOf: string, crew: CrewConfig): Analysis {
  // A Map keyed by "date|kind" keeps one report per kind per day; set() on an existing key replaces
  // it, so a re-uploaded report wins. ISO dates compare correctly as strings.
  const byKey = new Map<string, SavedExtraction>();
  for (const x of extractions) if (x.date <= asOf) byKey.set(`${x.date}|${reportKindOf(x.source_file)}`, x);
  const days = groupByDay([...byKey.values()]);

  const latestDay = days.at(-1); // .at(-1) = last element, or undefined if the list is empty
  if (!latestDay) {
    return {
      asOf, crew, reportCount: 0, latestReportDate: null, latestReportKinds: [], latestReadings: [], series: [], forecasts: [], flags: [],
      events: [], questions: [], waterScenarios: null, waterScenariosReason: "no reports on or before this date",
    };
  }

  // Only resources the crew has actually reported get a series and a forecast.
  const reported = TRACKED.filter((res) => days.some((d) => d.readings.some((r) => r.resource === res)));
  const series: ResourceSeries[] = [];
  const forecasts: Forecast[] = [];
  for (const resource of reported) {
    const { points, picked } = buildSeries(resource, days);
    series.push({ resource, points });
    forecasts.push(forecastResource(resource, picked));
  }

  const flags = computeFlags({ latestDay, earlierDays: days.slice(0, -1), series, forecasts, crew });
  const water = waterScenarios(series, asOf, crew);

  return {
    asOf,
    crew,
    reportCount: byKey.size,
    latestReportDate: latestDay.date,
    latestReportKinds: latestDay.report_kinds,
    latestReadings: latestDay.readings,
    series,
    forecasts,
    flags,
    events: latestDay.events,
    questions: latestDay.questions,
    waterScenarios: water.value,
    waterScenariosReason: water.reason,
  };
}
