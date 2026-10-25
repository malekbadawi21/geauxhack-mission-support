// tests/agent.test.ts — unit tests for the grounding check, the agent's tools and report validation.
// Run with: npm test
//
// How it fits: grounding.ts is our guard against invented numbers, and the tools are the only way the
// agent sees data, so both must behave exactly as documented. The tools are tested against the real
// Jan 13 Analysis fixture (data/demo/analysis-2015-01-13.json, written by `npm run build-demo`).
// Nothing here calls Gemini.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Analysis } from "../src/lib/analyze.ts";
import { checkGrounding, matchesWithinRounding } from "../src/lib/grounding.ts";
import { getFlagEvidence, getOverview, getResourceHistory, getWaterStatus, runTool } from "../src/lib/agent/tools.ts";
import { overallFromFlags, validateSubmission } from "../src/lib/agent/loop.ts";
import type { SubmittedReport } from "../src/lib/agent/tools.ts";

// `as Analysis`: the fixture is analyzeCrew's own JSON output, so we trust its shape here.
const jan13 = JSON.parse(readFileSync("data/demo/analysis-2015-01-13.json", "utf8")) as Analysis;

/** A report whose only text is `text` (in status_line); everything else empty. */
function reportSaying(text: string): SubmittedReport {
  return { as_of: "2015-01-13", overall: "critical", status_line: text, concerns: [], crew_actions: [], decisions_for_earth: [], message_to_earth: "" };
}

describe("checkGrounding", () => {
  const tools = [{ volume_l: 360, days_left: 4.243281471004244, quote: "Propane: 40%", runs_out_on: "2015-01-17" }];

  it("grounds exact matches, including numbers inside quoted strings", () => {
    const g = checkGrounding(reportSaying("About 360 L left; propane at 40%."), tools);
    expect(g).toEqual({ numbers_checked: 2, ungrounded: [] });
  });

  it("allows rounding (4.2 for 4.243) and 1% for numbers above 50", () => {
    expect(checkGrounding(reportSaying("Lasts 4.2 days, or about 4 days."), tools).ungrounded).toEqual([]);
    expect(matchesWithinRounding(363, 360)).toBe(true); // 3 is within 1% of 360
    expect(matchesWithinRounding(370, 360)).toBe(false);
  });

  it("lists numbers that appear in no tool output", () => {
    const g = checkGrounding(reportSaying("About 300 L left for 6 days; propane 40%."), tools);
    expect(g.numbers_checked).toBe(3);
    expect(g.ungrounded).toEqual(["300", "6"]);
  });

  it("grounds dates and years that appear in the data", () => {
    const g = checkGrounding(reportSaying("Water runs out on Jan 17, 2015 (2015-01-17)."), tools);
    expect(g.ungrounded).toEqual([]);
    expect(checkGrounding(reportSaying("Runs out Jan 19."), tools).ungrounded).toEqual(["19"]);
  });

  it("checks every text field, not just the status line", () => {
    const r = { ...reportSaying(""), message_to_earth: "Need 999 L.", crew_actions: ["Use 360 L."] };
    expect(checkGrounding(r, tools)).toEqual({ numbers_checked: 2, ungrounded: ["999"] });
  });
});

describe("agent tools on the Jan 13 analysis", () => {
  it("get_overview lists every flag with id, severity and message, plus counts", () => {
    const o = getOverview(jan13);
    expect(o.flags.map((f) => f.id)).toEqual(jan13.flags.map((f) => f.id));
    // 3 warnings, not 4: the commander's trailer-tank warning merged into the critical event (Phase 6, K7).
    expect(o.flag_counts).toEqual({ critical: 1, warning: 3, info: 1 });
    expect(o.days_until_mission_end).toBe(10);
    expect(o.latest_readings.find((r) => r.resource === "water_total")?.raw_text).toBe("~360l");
    expect(o.forecasts.find((f) => f.resource === "propane")).toMatchObject({ latest_value: 40, rate_per_day: -5, days_to_empty: 8 });
  });

  it("get_resource_history returns that resource's points, or an error listing what exists", () => {
    const h = getResourceHistory(jan13, "propane");
    expect(h.points?.map((p) => p.value)).toEqual([45, 40]); // ?. because the error branch has no points
    expect(getResourceHistory(jan13, "oxygen")).toMatchObject({ error: expect.any(String), available: expect.arrayContaining(["propane"]) });
  });

  it("get_flag_evidence returns the flag with its tagged quotes", () => {
    const f = getFlagEvidence(jan13, "CREW_REPORTED_EVENT:none:2015-01-13");
    expect(f).toMatchObject({ severity: "critical" });
    expect("evidence" in f && f.evidence[0]).toMatchObject({ report_kind: "engineering", quote: expect.stringContaining("ruptured") });
    expect(getFlagEvidence(jan13, "NOPE")).toHaveProperty("error");
  });

  it("get_water_status returns the analysis's water status (projected from the ~360 L estimate on Jan 13)", () => {
    const w = getWaterStatus(jan13);
    expect(w).toEqual(jan13.water);
    expect(w).toMatchObject({ mode: "projected", crew_size: 7, estimate: { volume_l: 360, days_since_estimate: 0 } });
    expect(getOverview(jan13).water_status_mode).toBe("projected");
  });

  it("runTool dispatches by name and reports unknown tools", () => {
    expect(runTool(jan13, "get_water_status", {})).toEqual(getWaterStatus(jan13));
    expect(runTool(jan13, "launch_rocket", {})).toEqual({ error: 'unknown tool "launch_rocket"' });
  });
});

describe("validateSubmission", () => {
  const good = {
    status_line: "Water resupply lost.",
    concerns: [{ title: "Water", detail: "Tank ruptured.", flag_ids: ["CREW_REPORTED_EVENT:none:2015-01-13"] }],
    crew_actions: [],
    decisions_for_earth: [],
    message_to_earth: "Trailer tank ruptured. ".repeat(14), // 42 words: above the 40-word floor
    overall: "nominal", // wrong on purpose: our code overwrites it from the flags
  };

  it("accepts a valid report and sets as_of and overall from the analysis", () => {
    const r = validateSubmission(good, jan13);
    expect(r.report).toMatchObject({ as_of: "2015-01-13", overall: "critical" });
    expect(overallFromFlags([])).toBe("nominal");
  });

  it("rejects placeholder text, unknown flag ids and uncovered critical flags", () => {
    expect(validateSubmission({ ...good, status_line: "test" }, jan13).error).toContain("status_line needs at least 3 words");
    expect(validateSubmission({ ...good, message_to_earth: "test test" }, jan13).error).toContain("message_to_earth has 2 words");
    expect(validateSubmission({ ...good, concerns: [{ title: "x", detail: "y", flag_ids: ["MADE_UP"] }] }, jan13).error)
      .toMatch(/unknown flag ids: MADE_UP.*critical flags not covered/);
  });

  it("rejects more than 3 decisions for Earth", () => {
    const decision = { decision: "Approve EVA.", why: "Crew asked." };
    expect(validateSubmission({ ...good, decisions_for_earth: Array(3).fill(decision) }, jan13).error).toBeUndefined();
    expect(validateSubmission({ ...good, decisions_for_earth: Array(4).fill(decision) }, jan13).error).toContain("at most 3 items");
  });
});
