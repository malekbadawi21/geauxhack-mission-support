// flags.ts — the deterministic alert rules. Every alert the crew or Earth sees comes from here.
//
// How it fits: analyze.ts merges each day's reports, builds the readings, series and forecasts, then
// calls computeFlags() with them. Each rule is a small, plain check against a threshold in
// constants.ts. Gemini's event `type` labels are never used to decide anything (CLAUDE.md: alerts come
// from our rules, not the LLM); event severity comes from keyword rules applied to the VERIFIED quote
// the crew actually wrote. Every flag carries `evidence`: the report quotes that justify it, each
// tagged with the report kind (engineering / commander) it came from. Browser-safe.
//
// Every flag has a stable `id` ("TYPE:resource:date", e.g. "TANK_EMPTY_REPORTED:water_static:2015-01-16")
// so the agent's report (report-types.ts) can point at the exact flags it is talking about.

import type { NormalizedReading } from "./normalize.ts";
import type { Forecast } from "./forecast.ts";
import type { Resource, VerifiedEvent, VerifiedQuestion } from "./schema.ts";
import type { CrewConfig } from "./constants.ts";
import { daysBetween } from "./dates.ts";
import {
  CRITICAL_EVENT_KEYWORDS,
  DAILY_ENGINEERING_RESOURCES,
  EVENT_KEY_NOUNS,
  LOW_LEVEL_PERCENT,
  MIN_DROPS_FOR_SPIKE,
  MIN_POINTS_FOR_CRITICAL_FORECAST,
  USAGE_SPIKE_MULTIPLIER,
  WARNING_EVENT_KEYWORDS,
} from "./constants.ts";

export type Severity = "critical" | "warning" | "info";

// One report quote, with the kind of report it was copied from.
export type Evidence = { report_kind: string; quote: string };

export type Flag = {
  id: string; // stable: `${type}:${resource ?? "none"}:${date}`, plus ":2", ":3" if that repeats in one analysis
  type:
    | "TANK_EMPTY_REPORTED"
    | "LOW_LEVEL"
    | "RUNS_OUT_BEFORE_MISSION_END"
    | "USAGE_SPIKE"
    | "MISSING_READING"
    | "UNVERIFIED_QUOTE"
    | "CREW_REPORTED_EVENT";
  severity: Severity;
  resource: Resource | null; // null for flags not tied to one resource (events, questions)
  message: string;
  evidence: Evidence[]; // source_quotes from the reports
};

// A flag before computeFlags() gives it an id. Omit<T, K> = T without the field K.
type FlagDraft = Omit<Flag, "id">;

// One point of a resource's time series (built by analyze.ts). Defined here, not in analyze.ts,
// so flags.ts doesn't import analyze.ts (which imports flags.ts) — avoiding a circular import.
export type SeriesPoint = {
  date: string;
  value: number | null; // as normalized; null if no usable number that day
  unit: NormalizedReading["unit"];
  measured_from: NormalizedReading["measured_from"];
  approximate: boolean; // the plotted reading was a crew estimate ("~360l")
  status: NormalizedReading["status"]; // "empty" / "half" / "full" when the crew wrote a state word
  raw_text: string | null; // what the crew wrote that day (null = resource not mentioned)
  source_quote: string | null; // quote of the plotted reading
  report_kind: string | null; // which report the plotted reading came from
  evidence: Evidence[]; // every quote about this resource that day, from every report
  change_from_previous: number | null; // amount change vs the previous comparable reading (negative = used up)
  change_per_day: number | null; // change_from_previous ÷ days since that reading
  refill: boolean;
};
export type ResourceSeries = { resource: Resource; points: SeriesPoint[] };

// T & { report_kind } = every field of T plus a report_kind (an intersection type).
export type Tagged<T> = T & { report_kind: string };

// Everything the crew reported on one date, merged across report kinds (built by analyze.ts).
export type ReportDay = {
  date: string;
  report_kinds: string[]; // e.g. ["engineering", "commander"], engineering first
  readings: NormalizedReading[]; // all of them, engineering first; each carries its report_kind
  events: Tagged<VerifiedEvent>[];
  questions: Tagged<VerifiedQuestion>[];
};

export type FlagInput = {
  latestDay: ReportDay; // the as-of day (or the latest day before it)
  earlierDays: ReportDay[]; // every day before it, oldest first
  series: ResourceSeries[];
  forecasts: Forecast[];
  crew: CrewConfig; // for the mission end date
};

/** Formats a number for a message: at most 1 decimal, no trailing ".0". */
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Turns anything with a report_kind and a source_quote (reading, event, question) into Evidence. */
const toEvidence = (x: { report_kind: string; source_quote: string }): Evidence => ({ report_kind: x.report_kind, quote: x.source_quote });

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

/**
 * TANK_EMPTY_REPORTED: the crew wrote that a tank is empty today (status "empty"). One flag per
 * resource, with every report's quote that says so. Today only: an "empty" from an earlier day may
 * have been refilled since.
 */
function tankEmptyFlags(readings: NormalizedReading[]): FlagDraft[] {
  // status is only set on verified readings (normalize.ts checks the quote first).
  const empty = readings.filter((r) => r.status === "empty");
  const resources = [...new Set(empty.map((r) => r.resource))]; // [...new Set(xs)] = xs without duplicates
  return resources.map((resource) => {
    const mine = empty.filter((r) => r.resource === resource);
    return {
      type: "TANK_EMPTY_REPORTED",
      severity: "critical",
      resource,
      message: `crew reported ${resource} empty on ${mine[0].date}`,
      evidence: mine.map(toEvidence),
    };
  });
}

/** LOW_LEVEL: a percent reading today below LOW_LEVEL_PERCENT. */
function lowLevelFlags(readings: NormalizedReading[]): FlagDraft[] {
  return readings
    .filter((r) => r.unit === "percent" && r.value !== null && r.value < LOW_LEVEL_PERCENT)
    .map((r) => ({
      type: "LOW_LEVEL",
      severity: "warning",
      resource: r.resource,
      message: `${r.resource} is at ${fmt(r.value!)}% (below our ${LOW_LEVEL_PERCENT}% threshold)`,
      evidence: [toEvidence(r)],
    }));
}

/**
 * RUNS_OUT_BEFORE_MISSION_END: forecast says empty before the crew's mission end.
 * Critical only when the rate rests on MIN_POINTS_FOR_CRITICAL_FORECAST readings; with fewer it is
 * a warning and says it is an early estimate (one interval can be a fluke).
 */
function runsOutFlags(forecasts: Forecast[], missionEnd: string): FlagDraft[] {
  const flags: FlagDraft[] = [];
  for (const f of forecasts) {
    if (f.days_to_empty === null || f.latest === null || f.first === null) continue;
    const daysLeft = daysBetween(f.latest.date, missionEnd); // counted from the same day as the forecast
    if (f.days_to_empty >= daysLeft) continue;
    const solid = f.points_used >= MIN_POINTS_FOR_CRITICAL_FORECAST;
    flags.push({
      type: "RUNS_OUT_BEFORE_MISSION_END",
      severity: solid ? "critical" : "warning",
      resource: f.resource,
      message:
        `${f.resource} empty in ~${fmt(f.days_to_empty)} days at ${fmt(f.rate_per_day!)} ${f.latest.unit}/day, ` +
        `before mission end ${missionEnd} (${daysLeft} days away) — ` +
        (solid ? `based on ${f.points_used} readings` : `early estimate — based on ${f.points_used} readings`),
      // Both ends of the rate, so a reader can check the arithmetic.
      evidence: [toEvidence(f.first), toEvidence(f.latest)],
    });
  }
  return flags;
}

/** USAGE_SPIKE: today's per-day drop is more than USAGE_SPIKE_MULTIPLIER × the median earlier drop. */
function spikeFlags(series: ResourceSeries[], today: string): FlagDraft[] {
  const flags: FlagDraft[] = [];
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
      evidence: last.source_quote && last.report_kind ? [{ report_kind: last.report_kind, quote: last.source_quote }] : [],
    });
  }
  return flags;
}

/**
 * MISSING_READING: a resource the engineering report records daily (DAILY_ENGINEERING_RESOURCES)
 * was reported on an earlier day but is absent from today's reports.
 */
function missingFlags(latestDay: ReportDay, earlierDays: ReportDay[]): FlagDraft[] {
  const today = new Set(latestDay.readings.map((r) => r.resource)); // Set = fast "is it in here?" lookups
  const previous = new Set(earlierDays.at(-1)?.readings.map((r) => r.resource) ?? []); // .at(-1) = last item
  const seen = new Set(earlierDays.flatMap((d) => d.readings.map((r) => r.resource)));
  const flags: FlagDraft[] = [];
  for (const resource of seen) {
    // Only daily engineering resources: occasional ones (water_total, "other", ...) are often absent.
    if (!DAILY_ENGINEERING_RESOURCES.includes(resource) || today.has(resource)) continue;
    // Newly missing (was in the previous day's reports) is a warning; long-absent is just info.
    const newlyMissing = previous.has(resource);
    const lastSeen = earlierDays.findLast((d) => d.readings.some((r) => r.resource === resource))!;
    flags.push({
      type: "MISSING_READING",
      severity: newlyMissing ? "warning" : "info",
      resource,
      message: `no ${resource} reading on ${latestDay.date} (last reported ${lastSeen.date})`,
      evidence: lastSeen.readings.filter((r) => r.resource === resource).map(toEvidence),
    });
  }
  return flags;
}

/** UNVERIFIED_QUOTE: any reading, event or question today whose quote isn't in its report. */
function unverifiedFlags(day: ReportDay): FlagDraft[] {
  const items = [
    // Each item becomes { what, resource, verified, report_kind, source_quote } so one filter/map handles all three kinds.
    // `as Resource | null` widens the readings' type so all three lists share one element type.
    ...day.readings.map((r) => ({ what: `${r.resource} reading "${r.raw_text}"`, resource: r.resource as Resource | null, verified: r.verified, report_kind: r.report_kind, source_quote: r.source_quote })),
    ...day.events.map((e) => ({ what: `event "${e.description}"`, resource: null, verified: e.verified, report_kind: e.report_kind, source_quote: e.source_quote })),
    ...day.questions.map((q) => ({ what: `question "${q.text}"`, resource: null, verified: q.verified, report_kind: q.report_kind, source_quote: q.source_quote })),
  ];
  return items
    .filter((i) => !i.verified)
    .map((i) => ({
      type: "UNVERIFIED_QUOTE",
      severity: "warning",
      resource: i.resource,
      message: `${i.what}: its quote was not found verbatim in the ${i.report_kind} report, so it is not used`,
      evidence: [toEvidence(i)],
    }));
}

/** The key nouns (EVENT_KEY_NOUNS) a quote names, lowercased. Used to spot one event told twice. */
function keyNouns(quote: string): string[] {
  const q = quote.toLowerCase();
  return EVENT_KEY_NOUNS.map((n) => n.toLowerCase()).filter((n) => q.includes(n));
}

/**
 * CREW_REPORTED_EVENT: every event in today's reports, with severity from our keyword rules.
 * When the engineering and commander reports describe the same event (same key noun in both verified
 * quotes), they become ONE flag: the higher severity, its description, and both quotes as evidence.
 * Events from the same report are never merged: "ATV 3 shut down" and "ATV 5 failed to start" in one
 * engineering report are two different breakdowns.
 */
function eventFlags(day: ReportDay): FlagDraft[] {
  type Group = { severity: Severity; description: string; kinds: string[]; nouns: string[]; evidence: Evidence[] };
  const groups: Group[] = [];
  for (const e of day.events) {
    // An unverified quote can't be trusted to set severity (it also gets an UNVERIFIED_QUOTE flag),
    // nor to say what the event was about, so it never merges.
    const severity: Severity = e.verified ? eventSeverity(e.source_quote) : "info";
    const nouns = e.verified ? keyNouns(e.source_quote) : [];
    // Same event = a group from another report kind that shares at least one key noun.
    const same = groups.find((g) => !g.kinds.includes(e.report_kind) && g.nouns.some((n) => nouns.includes(n)));
    if (!same) {
      groups.push({ severity, description: e.description, kinds: [e.report_kind], nouns, evidence: [toEvidence(e)] });
      continue;
    }
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[same.severity]) {
      // The new report sounds more serious: keep its severity and its wording.
      same.severity = severity;
      same.description = e.description;
    }
    same.kinds.push(e.report_kind);
    same.nouns = [...new Set([...same.nouns, ...nouns])];
    same.evidence.push(toEvidence(e));
  }
  return groups.map((g) => ({
    type: "CREW_REPORTED_EVENT",
    severity: g.severity,
    resource: null,
    message: `crew reported (${g.kinds.join(" + ")}): ${g.description}`,
    evidence: g.evidence,
  }));
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/**
 * Gives each flag its stable id: `${type}:${resource ?? "none"}:${date}`. When the same id appears
 * again (e.g. two crew-reported events on one day), later ones get ":2", ":3", ... in list order.
 * Why it exists: the agent's report cites flags by id, so ids must be unique and repeatable.
 */
function withIds(drafts: FlagDraft[], date: string): Flag[] {
  const seen = new Map<string, number>(); // base id → how many times we've used it so far
  return drafts.map((f) => {
    const base = `${f.type}:${f.resource ?? "none"}:${date}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { id: count === 1 ? base : `${base}:${count}`, ...f };
  });
}

/**
 * Runs every rule and returns all flags, most severe first.
 * @param input  The as-of day, earlier days, series, forecasts and crew config.
 * @returns      Flags sorted critical → warning → info (original order kept within a severity), each with an id.
 */
export function computeFlags(input: FlagInput): Flag[] {
  const all: FlagDraft[] = [
    ...eventFlags(input.latestDay),
    ...tankEmptyFlags(input.latestDay.readings),
    ...runsOutFlags(input.forecasts, input.crew.mission_end),
    ...lowLevelFlags(input.latestDay.readings),
    ...spikeFlags(input.series, input.latestDay.date),
    ...missingFlags(input.latestDay, input.earlierDays),
    ...unverifiedFlags(input.latestDay),
  ];
  // Array sort is stable in modern JS, so equal severities keep the order above. Ids are given
  // after sorting so the ":2" suffixes follow the order the flags are shown in.
  all.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return withIds(all, input.latestDay.date);
}
