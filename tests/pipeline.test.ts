// tests/pipeline.test.ts — small unit tests for normalize, forecast, flags, water and analyzeCrew.
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
import { CREW_147, type CrewConfig } from "../src/lib/constants.ts";
import { DailyReportSchema } from "../src/lib/report-types.ts";
import type { WaterStatus } from "../src/lib/water.ts";
import type { Flag } from "../src/lib/analyze.ts";
import { flagsForAlert } from "../src/ui/format.ts";
import type { SavedExtraction, VerifiedEvent, VerifiedReading } from "../src/lib/schema.ts";

/** A verified reading with sensible defaults; pass only the fields a test cares about. */
function reading(over: Partial<VerifiedReading>): VerifiedReading {
  // Partial<T> = T with every field optional. Spreading `over` last lets it override the defaults.
  return { resource: "propane", raw_text: "40%", value: null, unit: null, measured_from: null, source_quote: "Propane: 40%", verified: true, ...over };
}

/** A normalized percent (or other-unit) reading for forecast tests. */
function point(date: string, value: number, over: Partial<NormalizedReading> = {}): NormalizedReading {
  return { date, resource: "propane", value, unit: "percent", measured_from: null, approximate: false, status: null, report_kind: "engineering", raw_text: `${value}%`, source_quote: `Propane: ${value}%`, verified: true, reason: null, ...over };
}

/** A saved report of any kind with the given readings and events. */
function savedReport(date: string, kind: string, readings: VerifiedReading[], events: VerifiedEvent[] = []): SavedExtraction {
  return {
    report_date: null, crew: null, author: null, date, date_from_filename: true, source_file: `${date}-${kind}.txt`,
    readings,
    events,
    questions_to_mission_support: [],
  };
}

/** A saved engineering report with one propane reading. */
function report(date: string, pct: number): SavedExtraction {
  return savedReport(date, "engineering", [reading({ raw_text: `${pct}%`, source_quote: `Propane: ${pct}%` })]);
}

/** The commander's Jan 13 water volume, as it appears in the saved extraction. */
const volume360 = reading({ resource: "water_total", raw_text: "~360l", source_quote: "Evaluate the amount of water still available: ~360l", approximate: true });

// A crew with a far-off mission end, so RUNS_OUT tests only depend on the readings.
const LONG_CREW: CrewConfig = { ...CREW_147, mission_end: "2015-03-01" };

describe("normalizeReading", () => {
  it('turns "¾" diesel into 75 percent', () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "¾", source_quote: "Diesel: ¾" }), "2015-01-13", "engineering");
    expect(r.value).toBe(75);
    expect(r.unit).toBe("percent");
  });

  it('turns "40%" into 40 percent', () => {
    expect(normalizeReading(reading({}), "2015-01-13", "engineering").value).toBe(40);
  });

  it("returns null with a reason for text it can't convert exactly", () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "less than ¾", source_quote: "Diesel: less than ¾" }), "2015-01-16", "engineering");
    expect(r.value).toBeNull();
    expect(r.reason).toContain("bound");
  });

  it("returns null for an unverified quote even if the text is a clean number", () => {
    expect(normalizeReading(reading({ verified: false }), "2015-01-13", "engineering").value).toBeNull();
  });

  it('reads measured_from "top" from the quote wording', () => {
    const r = normalizeReading(
      reading({ resource: "water_static", raw_text: "13 cm", source_quote: "Static tank: 13 cm from the top" }),
      "2015-01-18",
      "engineering",
    );
    expect(r).toMatchObject({ value: 13, unit: "cm", measured_from: "top" }); // toMatchObject checks only these keys
  });
});

describe("normalizeReading: approximate values and tank states (Phase 3a)", () => {
  it('keeps "~360l" as 360 L marked approximate', () => {
    const r = normalizeReading(volume360, "2015-01-13", "commander");
    expect(r).toMatchObject({ value: 360, unit: "L", approximate: true, status: null, report_kind: "commander" });
  });

  it("marks a reading approximate when Gemini says so, even without a marker in the text", () => {
    const r = normalizeReading(reading({ approximate: true }), "2015-01-13", "engineering");
    expect(r).toMatchObject({ value: 40, approximate: true });
  });

  it("still rejects a bound, which is not an estimate", () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "less than ¾", source_quote: "Diesel: less than ¾" }), "2015-01-16", "engineering");
    expect(r.value).toBeNull();
    expect(r.approximate).toBe(false);
  });

  it.each([
    // it.each runs the same test once per row: [raw_text, expected status].
    ["empty", "empty"],
    ["half-empty", "half"],
    ["half", "half"],
    ["Full", "full"],
  ])('turns "%s" into status "%s" with value null', (raw, status) => {
    const r = normalizeReading(reading({ resource: "water_static", raw_text: raw, source_quote: `the static tank is ${raw}` }), "2015-01-16", "commander");
    expect(r.status).toBe(status);
    expect(r.value).toBeNull();
  });

  it('gives a fuel "full" a status, not the number 100', () => {
    const r = normalizeReading(reading({ resource: "diesel", raw_text: "full", source_quote: "Diesel: full" }), "2015-01-16", "engineering");
    expect(r).toMatchObject({ status: "full", value: null });
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
    const a = analyzeCrew(all, "2015-01-13", CREW_147);
    expect(a.reportCount).toBe(2);
    expect(a.latestReportDate).toBe("2015-01-13");
    expect(a.latestReadings[0].value).toBe(40);
    // The Jan 14 point must not appear in the chart series either.
    expect(a.series[0].points.map((p) => p.date)).toEqual(["2015-01-12", "2015-01-13"]);
  });
});

describe("analyzeCrew: merging a day's reports (Phase 3a)", () => {
  const day = "2015-01-13";
  const eng = savedReport(day, "engineering", [reading({ resource: "water_static", raw_text: "15cm", source_quote: "Static tank: 15cm" })], [
    { type: "leak", description: "Trailer tank ruptured", source_quote: "the trailer tank had ruptured", verified: true },
  ]);
  const cmd = savedReport(day, "commander", [reading({ resource: "water_static", raw_text: "10cm", source_quote: "static tank at 10cm" }), volume360], [
    { type: "resupply_issue", description: "Tank broke", source_quote: "was broken en route", verified: true },
  ]);

  it("prefers the engineering number, keeps both quotes, and lets the commander fill gaps", () => {
    // Commander first in the input: the merge must not depend on input order.
    const a = analyzeCrew([cmd, eng], day, CREW_147);
    const statik = a.series.find((s) => s.resource === "water_static")!.points[0];
    expect(statik).toMatchObject({ value: 15, report_kind: "engineering" });
    expect(statik.evidence.map((e) => e.report_kind)).toEqual(["engineering", "commander"]);
    const total = a.series.find((s) => s.resource === "water_total")!.points[0];
    expect(total).toMatchObject({ value: 360, approximate: true, report_kind: "commander" });
    expect(a.reportCount).toBe(2);
    expect(a.latestReportKinds).toEqual(["engineering", "commander"]);
  });

  it("unions events from both reports, tagged with their kind, and gives every flag a unique id", () => {
    const a = analyzeCrew([eng, cmd], day, CREW_147);
    expect(a.events.map((e) => e.report_kind)).toEqual(["engineering", "commander"]);
    const ids = a.flags.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("CREW_REPORTED_EVENT:none:2015-01-13");
    expect(ids).toContain("CREW_REPORTED_EVENT:none:2015-01-13:2");
  });

  it('raises TANK_EMPTY_REPORTED (critical) for a reported "empty" tank', () => {
    const empty = savedReport("2015-01-16", "commander", [reading({ resource: "water_static", raw_text: "empty", source_quote: "the static tank is empty" })]);
    const a = analyzeCrew([empty], "2015-01-16", CREW_147);
    const f = a.flags.find((x) => x.type === "TANK_EMPTY_REPORTED")!;
    expect(f).toMatchObject({ severity: "critical", resource: "water_static", id: "TANK_EMPTY_REPORTED:water_static:2015-01-16" });
    expect(f.evidence).toEqual([{ report_kind: "commander", quote: "the static tank is empty" }]);
  });
});

describe("MISSING_READING", () => {
  // Day 1: engineering propane + commander water_total. Day 2: engineering water_static only.
  const day1 = [report("2015-01-13", 40), savedReport("2015-01-13", "commander", [volume360])];
  const day2 = savedReport("2015-01-14", "engineering", [reading({ resource: "water_static", raw_text: "15cm", source_quote: "Static tank: 15cm" })]);

  it("fires for a daily engineering resource (propane) missing today", () => {
    const a = analyzeCrew([...day1, day2], "2015-01-14", CREW_147);
    expect(a.flags.find((f) => f.type === "MISSING_READING" && f.resource === "propane")).toBeDefined();
  });

  it("does not fire for a resource only ever reported by the commander (water_total)", () => {
    const a = analyzeCrew([...day1, day2], "2015-01-14", CREW_147);
    expect(a.flags.filter((f) => f.type === "MISSING_READING").map((f) => f.resource)).toEqual(["propane"]);
  });
});

describe("RUNS_OUT_BEFORE_MISSION_END severity (Phase 3a)", () => {
  it("is a warning, labeled an early estimate, with only 2 readings", () => {
    const a = analyzeCrew([report("2015-01-12", 45), report("2015-01-13", 40)], "2015-01-13", LONG_CREW);
    const f = a.flags.find((x) => x.type === "RUNS_OUT_BEFORE_MISSION_END")!;
    expect(f.severity).toBe("warning");
    expect(f.message).toContain("early estimate — based on 2 readings");
  });

  it("is critical with 3 readings", () => {
    const a = analyzeCrew([report("2015-01-12", 45), report("2015-01-13", 40), report("2015-01-14", 35)], "2015-01-14", LONG_CREW);
    const f = a.flags.find((x) => x.type === "RUNS_OUT_BEFORE_MISSION_END")!;
    expect(f.severity).toBe("critical");
    expect(f.message).not.toContain("early estimate");
  });
});

describe("water status (Phase 7)", () => {
  const jan13 = savedReport("2015-01-13", "commander", [volume360]);
  /** An engineering report with one static-tank reading, e.g. "empty", "Full", or "13 cm" from the top. */
  const tank = (date: string, raw: string, quote = `Static tank: ${raw}`) =>
    savedReport(date, "engineering", [reading({ resource: "water_static", raw_text: raw, source_quote: quote })]);
  /** The water status as of a date. `Extract` narrows the union to one mode (the test fails if it's another). */
  const projected = (xs: SavedExtraction[], asOf: string, crew = CREW_147) => {
    const w = analyzeCrew(xs, asOf, crew).water;
    expect(w.mode).toBe("projected");
    return w as Extract<WaterStatus, { mode: "projected" }>;
  };

  it("projects the estimate forward: used = crew × rate × days since the estimate", () => {
    for (const [asOf, days] of [["2015-01-13", 0], ["2015-01-14", 1], ["2015-01-15", 2], ["2015-01-16", 3]] as const) {
      const w = projected([jan13], asOf);
      expect(w.estimate).toMatchObject({ volume_l: 360, approximate: true, reading_date: "2015-01-13", days_since_estimate: days });
      const [fmars, nasa] = w.scenarios;
      // toBeCloseTo compares floating-point numbers to a few decimal places instead of exactly.
      expect(fmars.used_l).toBeCloseTo(7 * 12.12 * days);
      expect(fmars.remaining_l).toBeCloseTo(360 - 7 * 12.12 * days);
      expect(fmars.days_left).toBeCloseTo((360 - 7 * 12.12 * days) / (7 * 12.12));
      expect(nasa.remaining_l).toBeCloseTo(360 - 7 * 2.5 * days);
      expect(nasa.days_left).toBeCloseTo((360 - 7 * 2.5 * days) / (7 * 2.5));
      // Budget: what is left ÷ (crew × days until mission end), low end at FMARS, high end at NASA.
      const toEnd = 10 - days;
      expect(w.budget_to_mission_end!.if_typical_so_far).toBeCloseTo(fmars.remaining_l / (7 * toEnd));
      expect(w.budget_to_mission_end!.if_minimal_so_far).toBeCloseTo(nasa.remaining_l / (7 * toEnd));
      expect(w.notes).toContain("Projection from one crew estimate, not a measurement");
    }
    expect(projected([jan13], "2015-01-14").notes).toContain("Estimate is 1 day old");
  });

  it("gives a different remaining volume each day, but the same runs_out_on date", () => {
    const days = ["2015-01-14", "2015-01-15", "2015-01-16"].map((d) => projected([jan13], d));
    const remaining = days.map((w) => w.scenarios[0].remaining_l);
    expect(new Set(remaining).size).toBe(3); // three different numbers
    for (const w of days) {
      expect(w.scenarios[0].runs_out_on).toBe("2015-01-17"); // Jan 13 + floor(360 / 84.84 = 4.24)
      expect(w.scenarios[1].runs_out_on).toBe("2015-02-02"); // Jan 13 + floor(360 / 17.5 = 20.57)
      expect(w.scenarios.map((s) => s.status)).toEqual(["before_mission_end", "ok"]);
    }
  });

  it("clamps remaining at 0 and marks the scenario projected_empty", () => {
    const w = projected([jan13], "2015-01-18", LONG_CREW); // 5 days × 84.84 L > 360 L
    expect(w.scenarios[0]).toMatchObject({ remaining_l: 0, days_left: 0, status: "projected_empty", runs_out_on: "2015-01-17" });
    expect(w.scenarios[1].remaining_l).toBeCloseTo(360 - 7 * 2.5 * 5);
    expect(w.budget_to_mission_end!.if_typical_so_far).toBe(0);
  });

  it("has no budget once the mission end is reached", () => {
    expect(projected([jan13], "2015-01-23").budget_to_mission_end).toBeNull(); // the mission-end day itself
    expect(projected([jan13], "2015-01-25").budget_to_mission_end).toBeNull();
  });

  it("switches to since_refill after a refill: days since, estimated draw, no remaining", () => {
    const all = [
      jan13,
      tank("2015-01-16", "empty"),
      tank("2015-01-17", "Full"),
      tank("2015-01-18", "13 cm", "Static tank: 13 cm from the top"),
      tank("2015-01-19", "20 cm", "Static tank: 20 cm from the top"),
      tank("2015-01-21", "20 cm", "Static tank: 20 cm from the top"),
    ];
    expect(analyzeCrew(all, "2015-01-16", CREW_147).water.mode).toBe("projected"); // before the refill
    const w = analyzeCrew(all, "2015-01-21", CREW_147).water;
    if (w.mode !== "since_refill") throw new Error(`expected since_refill, got ${w.mode}`); // narrows the type below
    expect(w.refill).toMatchObject({ date: "2015-01-17", resource: "water_static", source_quote: "Static tank: Full", days_since_refill: 4 });
    expect(w.estimated_draw_since_refill.map((d) => d.used_l)).toEqual([7 * 12.12 * 4, 7 * 2.5 * 4]);
    expect(w.missing).toBe("No volume estimate since the 2015-01-17 refill — ask the crew for one.");
    expect(w.last_estimate_before_refill).toMatchObject({ volume_l: 360, reading_date: "2015-01-13" });
    expect("remaining_l" in w || "scenarios" in w).toBe(false); // remaining is never computed in this mode
    // The static tank's own trend since the refill: 13 → 20 cm from the top over 3 days = water down 7 cm.
    expect(w.measured_trend).toMatchObject({ resource: "water_static", unit: "cm", measured_from: "top", points_used: 3, from_date: "2015-01-18" });
    expect(w.measured_trend!.rate_per_day).toBeCloseTo(-7 / 3);
    expect(w.measured_trend!.description).toBe("level dropping ~2.3 cm/day (from-top readings, 2015-01-18 to 2015-01-21)");
  });

  it("gives no measured trend with fewer than 2 readings since the refill, and says why", () => {
    // "Full" only counts as a refill after the tank had fallen, hence the "empty" day before it.
    const all = [jan13, tank("2015-01-16", "empty"), tank("2015-01-17", "Full"), tank("2015-01-18", "13 cm", "Static tank: 13 cm from the top")];
    const w = analyzeCrew(all, "2015-01-18", CREW_147).water;
    if (w.mode !== "since_refill") throw new Error(`expected since_refill, got ${w.mode}`);
    expect(w.measured_trend).toBeNull();
    expect(w.measured_trend_reason).toBe("static tank has 1 comparable numeric reading since the 2015-01-17 refill; a trend needs 2");
  });

  it('is "none" when no volume was ever reported', () => {
    const w = analyzeCrew([report("2015-01-12", 45)], "2015-01-12", CREW_147).water;
    expect(w).toMatchObject({ mode: "none", reason: "No water volume estimate reported yet", crew_size: 7 });
  });
});

describe("crew-reported events", () => {
  /** A verified event from one report. */
  const event = (description: string, quote: string): VerifiedEvent => ({ type: "other", description, source_quote: quote, verified: true });

  it("merges the same event from the engineering and commander reports into one flag (K7)", () => {
    const eng = savedReport("2015-01-13", "engineering", [], [event("Trailer tank ruptured", "the trailer tank had ruptured")]);
    const cmd = savedReport("2015-01-13", "commander", [], [event("Resupply delayed", "The trailer tank was broken on route")]);
    const flags = analyzeCrew([eng, cmd], "2015-01-13", CREW_147).flags.filter((f) => f.type === "CREW_REPORTED_EVENT");
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe("critical"); // "ruptur" beats "broke": the higher severity is kept
    expect(flags[0].evidence.map((e) => e.report_kind)).toEqual(["engineering", "commander"]);
    expect(flags[0].message).toBe("crew reported (engineering + commander): Trailer tank ruptured");
  });

  it("keeps two events from the same report apart, even with the same key noun", () => {
    const eng = savedReport("2015-01-13", "engineering", [], [
      event("ATV 3 shut down", "ATV 3 powered on, but after 20 seconds shut down"),
      event("ATV 5 failed", "ATV 5 failed to start completely"),
    ]);
    expect(analyzeCrew([eng], "2015-01-13", CREW_147).flags.filter((f) => f.type === "CREW_REPORTED_EVENT")).toHaveLength(2);
  });
});

describe("forecastResource after a state word", () => {
  it("gives no rate when the crew described the tank in words after the last number (Q1)", () => {
    const cm = (date: string, value: number, over: Partial<NormalizedReading> = {}) =>
      point(date, value, { resource: "water_static", unit: "cm", raw_text: `${value}cm`, source_quote: `Static: ${value}cm`, ...over });
    const f = forecastResource("water_static", [
      cm("2015-01-13", 15),
      cm("2015-01-14", 15),
      cm("2015-01-16", 0, { value: null, status: "empty", raw_text: "empty" }),
      cm("2015-01-17", 0, { value: null, status: "full", raw_text: "Full" }),
    ]);
    expect(f.rate_per_day).toBeNull(); // not "steady, 0 cm/day" from the pre-refill readings
    expect(f.reason).toBe("crew reported it FULL on 2015-01-17, after the last numeric reading (2015-01-14)");
  });

  it('gives no rate when a later reading has words but no number, like "less than ¾" (Q3)', () => {
    const f = forecastResource("diesel", [
      point("2015-01-14", 75, { resource: "diesel" }),
      point("2015-01-15", 75, { resource: "diesel" }),
      point("2015-01-16", 0, { resource: "diesel", value: null, raw_text: "less than ¾" }),
    ]);
    expect(f.rate_per_day).toBeNull(); // not "steady" while the crew says it dropped below ¾
    expect(f.reason).toBe('crew wrote "less than ¾" on 2015-01-16, after the last numeric reading (2015-01-15)');
  });
});

describe("DailyReportSchema", () => {
  it("rejects a message to Earth over 120 words", () => {
    const base = { as_of: "2015-01-13", overall: "critical", status_line: "x", concerns: [], crew_actions: [], decisions_for_earth: [], grounding: { numbers_checked: 0, ungrounded: [] } };
    expect(DailyReportSchema.safeParse({ ...base, message_to_earth: "word ".repeat(120) }).success).toBe(true);
    expect(DailyReportSchema.safeParse({ ...base, message_to_earth: "word ".repeat(121) }).success).toBe(false);
  });
});

describe("flagsForAlert (critical-alert dialog)", () => {
  /** A flag with just an id and severity; the other fields don't matter to the rule. */
  const flag = (id: string, severity: Flag["severity"]): Flag => ({ id, type: "CREW_REPORTED_EVENT", severity, resource: null, message: id, evidence: [] });
  const flags = [flag("a", "critical"), flag("b", "warning"), flag("c", "critical"), flag("d", "info")];

  it("keeps only critical flags", () => {
    expect(flagsForAlert(flags, new Set()).map((f) => f.id)).toEqual(["a", "c"]);
  });
  it("leaves out flags already acknowledged", () => {
    expect(flagsForAlert(flags, new Set(["a"])).map((f) => f.id)).toEqual(["c"]);
    expect(flagsForAlert(flags, new Set(["a", "c"]))).toEqual([]);
  });
});
