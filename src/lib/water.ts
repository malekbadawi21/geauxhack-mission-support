// water.ts — "how long would the crew's water last?" at two published reference rates.
//
// How it fits: the tank readings can't give a water forecast (depths in cm with no tank capacity),
// but the commander once stated a total volume (Jan 13: "~360l"). analyze.ts calls waterScenarios()
// with the chart series; we take that volume and divide it by crew size × a reference rate from
// baselines.ts. These are scenarios ("if they used water like FMARS crews did…"), not predictions,
// and the notes say so. Browser-safe: plain arithmetic, no file or network access.
//
// The volume goes stale the moment a tank is refilled, so if any water series shows a refill after
// the volume was stated, we return null with a reason instead of a misleading number.

import type { CrewConfig } from "./constants.ts";
import type { ResourceSeries, SeriesPoint } from "./flags.ts";
import { convertValue } from "./normalize.ts";
import { addDays, daysBetween } from "./dates.ts";
import {
  FMARS_AVG_WATER_L_PER_CREW_SOL,
  FMARS_AVG_WATER_SOURCE,
  NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY,
  NASA_MIN_POTABLE_WATER_SOURCE,
} from "./baselines.ts";

export type WaterScenario = {
  id: "fmars_average" | "nasa_minimum";
  label: string;
  rate_l_per_person_day: number;
  source_url: string; // where the rate comes from (baselines.ts)
  days_left: number; // volume ÷ (crew size × rate), unrounded
  runs_out_on: string; // reading_date + floor(days_left) days
};

export type WaterScenarios = {
  volume_l: number;
  approximate: boolean; // the volume was a crew estimate ("~360l")
  reading_date: string; // the day the volume was stated; every count below starts here
  source_quote: string;
  crew_size: number;
  crew_size_source: string;
  days_until_mission_end: number; // from reading_date to crew.mission_end
  scenarios: WaterScenario[];
  required_rate_to_mission_end_l_per_person_day: number | null; // null if mission end isn't after reading_date
  notes: string[];
};

// Either scenarios, or null with a reason the UI can show. The `|` makes it one or the other.
export type WaterScenarioResult = { value: WaterScenarios; reason: null } | { value: null; reason: string };

// The series that hold water. A refill in any of them makes an earlier total volume stale.
const WATER_RESOURCES = ["water_total", "water_static", "water_loft", "water_trailer"];

/** The latest volume reading and the first refill after it — see latestWaterVolume(). */
export type WaterVolumeStatus = {
  reading: SeriesPoint | null; // latest water_total point with a number in liters, on or before asOf
  refilled_on: string | null; // first refill in any water series after that reading (on or before asOf)
};

/**
 * Finds the crew's latest total water volume and whether a refill has made it stale.
 * @param series  analyzeCrew's chart series.
 * @param asOf    YYYY-MM-DD; only readings and refills up to this date count.
 * @returns       { reading, refilled_on }: reading null = no volume yet; refilled_on non-null = the
 *                volume predates that refill and must not be shown as current.
 * Why it exists: the one staleness rule shared by waterScenarios() below and the "Water on hand"
 * card in the UI, so the card can never show a volume the scenarios refused to use (Phase 6, K2).
 */
export function latestWaterVolume(series: ResourceSeries[], asOf: string): WaterVolumeStatus {
  const totals = series.find((s) => s.resource === "water_total")?.points ?? [];
  const reading =
    totals.findLast((p) => p.date <= asOf && p.value !== null && p.unit !== null && convertValue(p.value, p.unit, "L") !== null) ?? null;
  if (!reading) return { reading: null, refilled_on: null };
  // A refill (status "full" after a fall, or a jump in level) after the volume was stated makes it stale.
  const refills = series
    .filter((s) => WATER_RESOURCES.includes(s.resource))
    .flatMap((s) => s.points.filter((p) => p.refill && p.date > reading.date && p.date <= asOf).map((p) => p.date))
    .sort(); // ISO dates sort correctly as strings; [0] is the earliest
  return { reading, refilled_on: refills[0] ?? null };
}

/**
 * Builds the water scenarios from the most recent total-volume reading on or before asOf.
 * @param series  analyzeCrew's chart series (already limited to days on or before asOf).
 * @param asOf    YYYY-MM-DD; only readings and refills up to this date count.
 * @param crew    Crew config: size and mission end (never from an extraction).
 * @returns       { value: scenarios, reason: null }, or { value: null, reason } when no usable volume.
 * Why it exists: the one place a water volume becomes "days left", so the UI and agent can't disagree.
 */
export function waterScenarios(series: ResourceSeries[], asOf: string, crew: CrewConfig): WaterScenarioResult {
  const { reading, refilled_on } = latestWaterVolume(series, asOf);
  if (!reading || reading.value === null || reading.unit === null || reading.source_quote === null) {
    return { value: null, reason: "no total water volume reported on or before this date" };
  }
  if (refilled_on) return { value: null, reason: `last volume estimate (${reading.date}) predates the ${refilled_on} refill` };

  const volume = convertValue(reading.value, reading.unit, "L")!; // `!`: checked non-null in findLast above
  const daysToEnd = daysBetween(reading.date, crew.mission_end);

  /** One scenario: how long the volume lasts if every crew member uses `rate` liters a day. */
  const scenario = (id: WaterScenario["id"], label: string, rate: number, source_url: string): WaterScenario => {
    const days_left = volume / (crew.size * rate);
    return { id, label, rate_l_per_person_day: rate, source_url, days_left, runs_out_on: addDays(reading.date, Math.floor(days_left)) };
  };

  const notes = [
    "FMARS figure is measured per sol (24h 39m) at a different analog station; used as a reference, not a prediction",
    "NASA figure is a minimum for drinking water only, not total use",
  ];
  if (reading.approximate) notes.unshift("Volume is a crew estimate (approximate)"); // unshift = add to the front

  return {
    value: {
      volume_l: volume,
      approximate: reading.approximate,
      reading_date: reading.date,
      source_quote: reading.source_quote,
      crew_size: crew.size,
      crew_size_source: crew.size_source,
      days_until_mission_end: daysToEnd,
      scenarios: [
        scenario("fmars_average", "Arctic analog average (FMARS)", FMARS_AVG_WATER_L_PER_CREW_SOL, FMARS_AVG_WATER_SOURCE),
        scenario("nasa_minimum", "NASA potable-water minimum", NASA_MIN_POTABLE_WATER_L_PER_CREW_DAY, NASA_MIN_POTABLE_WATER_SOURCE),
      ],
      // Liters per person per day that would make the volume last exactly to mission end.
      required_rate_to_mission_end_l_per_person_day: daysToEnd > 0 ? volume / (crew.size * daysToEnd) : null,
      notes,
    },
    reason: null,
  };
}
