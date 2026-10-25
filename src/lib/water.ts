// water.ts — "how much water does the crew have?" as honestly as the reports allow.
//
// How it fits: the tank readings can't give a water volume (depths in cm with no tank capacity), but
// the commander sometimes states a total volume (Jan 13: "~360l"). analyze.ts calls waterStatus() with
// the chart series and forecasts; the UI's water panel, the "Water on hand" card and the agent's
// get_water_status tool all read the one object it returns, so they can never disagree.
//
// It has three modes (Phase 7):
//   - "projected":    a volume estimate exists and no refill came after it. We project it forward to the
//                     as-of date at two published reference rates (baselines.ts): what is left and how
//                     long it lasts IF the crew used water like that. A projection, not a measurement.
//   - "since_refill": a refill came after the latest estimate, so the estimate no longer describes the
//                     tanks. We never compute "remaining" here: we show the days since the refill, the
//                     static tank's own measured trend, and an estimate of the water USED since then.
//   - "none":         no volume estimate at all yet.
// Browser-safe: plain arithmetic, no file or network access.

import type { CrewConfig } from "./constants.ts";
import type { ResourceSeries, SeriesPoint } from "./flags.ts";
import type { Forecast } from "./forecast.ts";
import { convertValue } from "./normalize.ts";
import { addDays, daysBetween } from "./dates.ts";
import {
  FMARS_AVG_WATER_L_PER_CREW_SOL,
  FMARS_AVG_WATER_SOURCE,
  NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY,
  NASA_MIN_POTABLE_WATER_SOURCE,
} from "./baselines.ts";

/** One reference rate: who measured it and how many liters per person per day. */
export type WaterRate = {
  id: "fmars_average" | "nasa_minimum";
  label: string;
  rate_l_per_person_day: number;
  source_url: string; // where the rate comes from (baselines.ts)
};

/** One rate projected forward from the estimate to the as-of date ("projected" mode). */
export type ProjectedScenario = WaterRate & {
  used_l: number; // crew × rate × days since the estimate
  remaining_l: number; // volume − used, never below 0
  days_left: number; // remaining ÷ (crew × rate), counted from the as-of date, unrounded
  runs_out_on: string; // estimate date + floor(volume ÷ (crew × rate)) days — the same on every as-of day
  status: "ok" | "before_mission_end" | "projected_empty";
};

/** Water used since the refill at one rate ("since_refill" mode). An amount USED, never remaining. */
export type DrawScenario = WaterRate & { used_l: number };

/** The crew's volume estimate that a projection starts from. */
export type WaterEstimate = {
  volume_l: number;
  approximate: boolean; // the crew wrote it as an estimate ("~360l")
  reading_date: string; // the day the volume was stated
  source_quote: string;
  days_since_estimate: number; // from reading_date to the as-of date
};

/** The static tank's own trend since the refill, from forecast.ts (no new math here). */
export type MeasuredTrend = {
  resource: string;
  rate_per_day: number; // change in AMOUNT per day: negative = the water level is falling
  unit: string;
  measured_from: string | null; // "top" = depth of the empty space above the water
  points_used: number;
  from_date: string;
  to_date: string;
  description: string; // e.g. "level dropping ~5 cm/day (from-top readings, 2015-01-18 to 2015-01-23)"
};

// Fields every mode has, so the UI and agent always know the crew and the dates.
type WaterCommon = {
  as_of: string;
  crew_size: number;
  crew_size_source: string;
  mission_end: string;
  days_until_mission_end: number; // from the as-of date (0 or negative once the mission has ended)
  notes: string[];
};

export type WaterProjected = WaterCommon & {
  mode: "projected";
  estimate: WaterEstimate;
  scenarios: ProjectedScenario[];
  // L/person/day that makes each scenario's remaining water last to mission end; null if mission end ≤ asOf.
  budget_to_mission_end: { if_typical_so_far: number; if_minimal_so_far: number } | null;
};

export type WaterSinceRefill = WaterCommon & {
  mode: "since_refill";
  refill: { date: string; resource: string; source_quote: string | null; days_since_refill: number };
  last_estimate_before_refill: Omit<WaterEstimate, "days_since_estimate">; // shown as stale, never as current
  measured_trend: MeasuredTrend | null;
  measured_trend_reason: string | null; // why measured_trend is null; null when it isn't
  estimated_draw_since_refill: DrawScenario[];
  missing: string; // the data we need from the crew, as a sentence
};

export type WaterNone = WaterCommon & { mode: "none"; reason: string };

// The `|` makes it exactly one of the three; `mode` tells TypeScript (and the UI) which one.
export type WaterStatus = WaterProjected | WaterSinceRefill | WaterNone;

// The series that hold water. A refill in any of them makes an earlier total volume stale.
const WATER_RESOURCES = ["water_total", "water_static", "water_loft", "water_trailer"];

// The two reference rates, in the order the UI shows them.
const RATES: WaterRate[] = [
  { id: "fmars_average", label: "Arctic analog average (FMARS)", rate_l_per_person_day: FMARS_AVG_WATER_L_PER_CREW_SOL, source_url: FMARS_AVG_WATER_SOURCE },
  { id: "nasa_minimum", label: "NASA potable-water minimum", rate_l_per_person_day: NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY, source_url: NASA_MIN_POTABLE_WATER_SOURCE },
];

const RATE_NOTES = [
  "FMARS figure is measured per sol (24h 39m) at a different analog station; used as a reference, not a prediction",
  "NASA figure is a minimum for drinking water only, not total use",
];

/** "1 day" / "3 days": a count with its noun in the right number. */
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * The latest total-volume reading (in liters) on or before asOf, or null if the crew never gave one.
 * Why it exists: water_total is the only series that can hold a volume; other water series are depths.
 */
function latestVolume(series: ResourceSeries[], asOf: string): SeriesPoint | null {
  const totals = series.find((s) => s.resource === "water_total")?.points ?? [];
  return (
    totals.findLast(
      (p) => p.date <= asOf && p.value !== null && p.unit !== null && p.source_quote !== null && convertValue(p.value, p.unit, "L") !== null,
    ) ?? null
  );
}

/**
 * The latest refill in any water series after `after` and on or before asOf.
 * @returns  { date, resource, point }, or null if no water series was refilled in that window.
 * Why the latest: "since the refill" counts from the most recent one; ties on a day go to the first
 * resource in WATER_RESOURCES (the static tank before the loft tank).
 */
function latestRefill(series: ResourceSeries[], after: string, asOf: string): { date: string; resource: string; point: SeriesPoint } | null {
  const refills = WATER_RESOURCES.flatMap((resource) =>
    (series.find((s) => s.resource === resource)?.points ?? [])
      .filter((p) => p.refill && p.date > after && p.date <= asOf)
      .map((point) => ({ date: point.date, resource, point })),
  );
  // Newest date first; .sort is stable, so same-day refills keep WATER_RESOURCES order.
  refills.sort((a, b) => b.date.localeCompare(a.date));
  return refills[0] ?? null;
}

/**
 * The static tank's measured trend since the refill, if forecast.ts found one.
 * @returns  { trend, reason }: the trend, or null with the reason it can't be given.
 * Why it exists: in since_refill mode this is the only number about the tanks that the crew measured.
 */
function measuredTrend(forecasts: Forecast[], refillDate: string): { trend: MeasuredTrend | null; reason: string | null } {
  const f = forecasts.find((x) => x.resource === "water_static");
  // The rate must rest on ≥2 readings, all after the refill (first = oldest reading in its window).
  if (!f || f.rate_per_day === null || !f.latest || !f.first || f.points_used < 2 || f.first.date < refillDate) {
    const n = f && f.first && f.first.date >= refillDate ? f.points_used : 0;
    return { trend: null, reason: `static tank has ${n} comparable numeric reading${n === 1 ? "" : "s"} since the ${refillDate} refill; a trend needs 2` };
  }
  const rate = f.rate_per_day;
  const word = rate < 0 ? "dropping" : rate > 0 ? "rising" : "steady";
  const size = Math.round(Math.abs(rate) * 10) / 10; // one decimal, for the sentence only
  const unit = f.latest.unit ?? "";
  const from = f.latest.measured_from ? `from-${f.latest.measured_from} readings` : "readings";
  return {
    trend: {
      resource: f.resource,
      rate_per_day: rate,
      unit,
      measured_from: f.latest.measured_from,
      points_used: f.points_used,
      from_date: f.first.date,
      to_date: f.latest.date,
      description: `level ${word}${rate === 0 ? "" : ` ~${size} ${unit}/day`} (${from}, ${f.first.date} to ${f.latest.date})`,
    },
    reason: null,
  };
}

/**
 * The crew's water situation on asOf, in one of three modes (see the header).
 * @param series     analyzeCrew's chart series (already limited to days on or before asOf).
 * @param forecasts  analyzeCrew's forecasts (the static tank's trend comes from here).
 * @param asOf       YYYY-MM-DD; every "days since" counts to this date.
 * @param crew       Crew config: size and mission end (never from an extraction).
 * @returns          A WaterStatus. Every number is arithmetic on the estimate, the crew size and the
 *                   baselines.ts rates — no volume is ever invented.
 * Why it exists: the one place water becomes litres and days, shared by the UI and the agent.
 */
export function waterStatus(series: ResourceSeries[], forecasts: Forecast[], asOf: string, crew: CrewConfig): WaterStatus {
  const daysToEnd = daysBetween(asOf, crew.mission_end);
  const common = { as_of: asOf, crew_size: crew.size, crew_size_source: crew.size_source, mission_end: crew.mission_end, days_until_mission_end: daysToEnd };

  const reading = latestVolume(series, asOf);
  if (!reading) {
    return { ...common, mode: "none", reason: "No water volume estimate reported yet", notes: ["Ask the crew for an estimate of the total water on hand"] };
  }
  // `!`: latestVolume only returns points whose value, unit and quote are non-null and convertible.
  const volume = convertValue(reading.value!, reading.unit!, "L")!;
  const estimate = { volume_l: volume, approximate: reading.approximate, reading_date: reading.date, source_quote: reading.source_quote! };

  const refill = latestRefill(series, reading.date, asOf);
  if (refill) {
    const sinceRefill = daysBetween(refill.date, asOf);
    const { trend, reason } = measuredTrend(forecasts, refill.date);
    return {
      ...common,
      mode: "since_refill",
      refill: { date: refill.date, resource: refill.resource, source_quote: refill.point.source_quote, days_since_refill: sinceRefill },
      last_estimate_before_refill: estimate,
      measured_trend: trend,
      measured_trend_reason: reason,
      estimated_draw_since_refill: RATES.map((r) => ({ ...r, used_l: crew.size * r.rate_l_per_person_day * sinceRefill })),
      missing: `No volume estimate since the ${refill.date} refill — ask the crew for one.`,
      notes: [
        "Draw figures estimate water USED since the refill at reference rates, not water remaining",
        "Tank capacities are unknown, so the refill can't be turned into litres on hand",
        ...RATE_NOTES,
      ],
    };
  }

  const sinceEstimate = daysBetween(reading.date, asOf);
  const daysEstimateToEnd = daysBetween(reading.date, crew.mission_end);
  const scenarios: ProjectedScenario[] = RATES.map((r) => {
    const perDay = crew.size * r.rate_l_per_person_day; // litres the whole crew uses per day
    const used = perDay * sinceEstimate;
    const remaining = Math.max(0, volume - used); // a projection can't go below empty
    const lastsDays = volume / perDay; // from the estimate date, so it doesn't move with asOf
    return {
      ...r,
      used_l: used,
      remaining_l: remaining,
      days_left: remaining / perDay,
      runs_out_on: addDays(reading.date, Math.floor(lastsDays)),
      status: remaining === 0 ? "projected_empty" : lastsDays < daysEstimateToEnd ? "before_mission_end" : "ok",
    };
  });
  /** L/person/day that makes a scenario's remaining water last exactly to mission end. */
  const budget = (id: WaterRate["id"]) => scenarios.find((s) => s.id === id)!.remaining_l / (crew.size * daysToEnd);

  return {
    ...common,
    mode: "projected",
    estimate: { ...estimate, days_since_estimate: sinceEstimate },
    scenarios,
    budget_to_mission_end: daysToEnd > 0 ? { if_typical_so_far: budget("fmars_average"), if_minimal_so_far: budget("nasa_minimum") } : null,
    notes: [
      "Projection from one crew estimate, not a measurement",
      sinceEstimate === 0 ? "Estimate is from today" : `Estimate is ${days(sinceEstimate)} old`,
      ...(reading.approximate ? ["Volume is a crew estimate (approximate)"] : []), // spread of [] adds nothing
      ...RATE_NOTES,
    ],
  };
}
