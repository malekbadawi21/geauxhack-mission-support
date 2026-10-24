// tests/pipeline.test.ts — small unit tests for normalize, forecast and analyzeCrew.
// Run with: npm test   (vitest finds every *.test.ts file and runs it in Node)
//
// How it fits: these pin down the rules we rely on in the demo (¾ → 75, refills reset the window,
// no looking ahead) so a later change can't quietly break them. Inputs are built by hand here, so
// the tests never need Gemini or the files in data/.

// describe groups related tests; it() is one test; expect(x).toBe(y) fails the test if x !== y.
import { describe, expect, it } from "vitest";
import { normalizeReading, type NormalizedReading } from "../src/lib/normalize.ts";
import { forecastResource } from "../src/lib/forecast.ts";
import { analyzeCrew } from "../src/lib/analyze.ts";
import type { SavedExtraction, VerifiedReading } from "../src/lib/schema.ts";

/** A verified reading with sensible defaults; pass only the fields a test cares about. */
function reading(over: Partial<VerifiedReading>): VerifiedReading {
  // Partial<T> = T with every field optional. Spreading `over` last lets it override the defaults.
  return { resource: "propane", raw_text: "40%", value: null, unit: null, measured_from: null, source_quote: "Propane: 40%", verified: true, ...over };
}

/** A normalized percent (or other-unit) reading for forecast tests. */
function point(date: string, value: number, over: Partial<NormalizedReading> = {}): NormalizedReading {
  return { date, resource: "propane", value, unit: "percent", measured_from: null, raw_text: `${value}%`, source_quote: `Propane: ${value}%`, verified: true, reason: null, ...over };
}

/** A saved report with one propane reading. */
function report(date: string, pct: number): SavedExtraction {
  return {
    report_date: null, crew: null, author: null, date, date_from_filename: true, source_file: `${date}-engineering.txt`,
    readings: [reading({ raw_text: `${pct}%`, source_quote: `Propane: ${pct}%` })],
    events: [],
    questions_to_mission_support: [],
  };
}

describe("normalizeReading", () => {
  it('turns "¾" diesel into 75 percent', () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "¾", source_quote: "Diesel: ¾" }), "2015-01-13");
    expect(r.value).toBe(75);
    expect(r.unit).toBe("percent");
  });

  it('turns "40%" into 40 percent', () => {
    expect(normalizeReading(reading({}), "2015-01-13").value).toBe(40);
  });

  it("returns null with a reason for text it can't convert exactly", () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "less than ¾", source_quote: "Diesel: less than ¾" }), "2015-01-16");
    expect(r.value).toBeNull();
    expect(r.reason).toContain("bound");
  });

  it("returns null for an unverified quote even if the text is a clean number", () => {
    expect(normalizeReading(reading({ verified: false }), "2015-01-13").value).toBeNull();
  });

  it('reads measured_from "top" from the quote wording', () => {
    const r = normalizeReading(
      reading({ resource: "water_static", raw_text: "13 cm", source_quote: "Static tank: 13 cm from the top" }),
      "2015-01-18",
    );
    expect(r).toMatchObject({ value: 13, unit: "cm", measured_from: "top" }); // toMatchObject checks only these keys
  });
});

describe("forecastResource", () => {
  it("resets the window at a refill above the threshold", () => {
    // 40 → 30 → refill to 90 (+60 points) → 80. Only 90 and 80 should be used.
    const f = forecastResource("propane", [point("2015-01-01", 40), point("2015-01-02", 30), point("2015-01-03", 90), point("2015-01-04", 80)]);
    expect(f.points_used).toBe(2);
    expect(f.rate_per_day).toBe(-10);
    expect(f.days_to_empty).toBe(8);
  });

  it("keeps a +2 point bump in the window (noise, not a refill)", () => {
    // 40 → 42 → 34 over 2 days: all 3 used, rate (34 − 40) / 2 = −3.
    const f = forecastResource("propane", [point("2015-01-01", 40), point("2015-01-02", 42), point("2015-01-03", 34)]);
    expect(f.points_used).toBe(3);
    expect(f.rate_per_day).toBe(-3);
  });

  it("gives no rate with fewer than 2 readings", () => {
    const f = forecastResource("propane", [point("2015-01-01", 40)]);
    expect(f.rate_per_day).toBeNull();
    expect(f.days_to_empty).toBeNull();
    expect(f.reason).not.toBeNull();
  });

  it("gives a trend but no days_to_empty for a depth measured from the top", () => {
    const top = { resource: "water_static" as const, unit: "cm" as const, measured_from: "top" as const };
    // 13 → 20 cm from the top = water fell 7 cm in 1 day.
    const f = forecastResource("water_static", [point("2015-01-18", 13, top), point("2015-01-19", 20, top)]);
    expect(f.rate_per_day).toBe(-7);
    expect(f.days_to_empty).toBeNull();
    expect(f.reason).toContain("top");
  });
});

describe("analyzeCrew", () => {
  it("ignores reports dated after asOf", () => {
    const all = [report("2015-01-12", 45), report("2015-01-13", 40), report("2015-01-14", 10)];
    const a = analyzeCrew(all, "2015-01-13");
    expect(a.reportCount).toBe(2);
    expect(a.latestReportDate).toBe("2015-01-13");
    expect(a.latestReadings[0].value).toBe(40);
    // The Jan 14 point must not appear in the chart series either.
    expect(a.series[0].points.map((p) => p.date)).toEqual(["2015-01-12", "2015-01-13"]);
  });
});
