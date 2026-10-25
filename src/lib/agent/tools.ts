// agent/tools.ts — the tools the agent can call, and what each one returns.
//
// How it fits: loop.ts gives Gemini these declarations (name, description, parameter schema) and,
// when Gemini asks for a tool, runs the matching function here. Every tool only READS an Analysis
// that analyzeCrew() already computed — none of them call Gemini or do new math — so every number the
// agent sees comes from our deterministic code. grounding.ts later checks the report against exactly
// these outputs.
//
// SERVER-ONLY by placement (src/lib/agent/ is excluded from the browser build), because it is only
// used by the agent loop, which holds the Gemini key. The tool functions themselves are pure.

// `import type`: only the TypeScript type of a declaration; nothing from the SDK runs here.
import type { FunctionDeclaration } from "@google/genai";
import { z } from "zod";
import type { Analysis } from "../analyze.ts";
import { DailyReportSchema } from "../report-types.ts";
import { daysBetween } from "../dates.ts";

export const SUBMIT_TOOL = "submit_daily_report";

// The report the agent submits: the contract's DailyReport without `grounding`, which our code fills.
// .omit({ key: true }) makes a new schema without that field.
export const SubmittedReportSchema = DailyReportSchema.omit({ grounding: true });
export type SubmittedReport = z.infer<typeof SubmittedReportSchema>;

// What Gemini sees. `parametersJsonSchema` takes standard JSON Schema; z.toJSONSchema converts our zod
// schema so the declared shape can't drift from the one we validate against. (The 120-word .refine
// rule isn't expressible in JSON Schema, so it's checked when we validate, and stated in the prompt.)
export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "get_overview",
    description:
      "Start here. Crew, dates, report counts, today's readings, forecasts, every flag (id, severity, message), " +
      "and the questions the crew asked Mission Support today.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: "get_resource_history",
    description: "One resource's daily series up to today: value, unit, state word, change per day, refills.",
    parametersJsonSchema: {
      type: "object",
      properties: { resource: { type: "string", description: 'e.g. "propane", "diesel", "water_static", "water_total"' } },
      required: ["resource"],
    },
  },
  {
    name: "get_flag_evidence",
    description: "One flag in full, with the exact report quotes behind it and which report (engineering/commander) each came from.",
    parametersJsonSchema: {
      type: "object",
      properties: { flag_id: { type: "string", description: "A flag id from get_overview" } },
      required: ["flag_id"],
    },
  },
  {
    name: "get_water_status",
    description:
      "The crew's water situation today, in one of three modes. " +
      "mode \"projected\": the crew's last volume estimate projected forward to today at two published reference rates " +
      "(FMARS average, NASA minimum): litres remaining, days left, run-out date, and the daily budget per person to reach " +
      "mission end. These are projections from one crew estimate, not measurements: always say so (e.g. \"projected\", " +
      "\"if usage matched FMARS\"). " +
      "mode \"since_refill\": a tank was refilled after the last estimate, so the water remaining is UNKNOWN. Report the " +
      "days since the refill and the static tank's measured trend; estimated_draw_since_refill is water USED since the " +
      "refill, never water remaining. In this mode you must include asking the crew for a new total water volume estimate " +
      "(in crew_actions, or in decisions_for_earth within the 3-decision cap). " +
      "mode \"none\": no volume estimate yet; say so.",
    parametersJsonSchema: { type: "object", properties: {} },
  },
  {
    name: SUBMIT_TOOL,
    description: "Submit the finished daily report. Call this exactly once, after investigating. It ends the run.",
    parametersJsonSchema: z.toJSONSchema(SubmittedReportSchema),
  },
];

/** get_overview: the summary the agent reads first. Flags without evidence (that's get_flag_evidence). */
export function getOverview(a: Analysis) {
  // Counts per severity, so the agent sees the shape of the day at a glance.
  const count = (s: string) => a.flags.filter((f) => f.severity === s).length;
  return {
    crew: { name: a.crew.name, size: a.crew.size, mission_end: a.crew.mission_end },
    as_of: a.asOf,
    days_until_mission_end: daysBetween(a.asOf, a.crew.mission_end),
    report_count: a.reportCount,
    latest_report_date: a.latestReportDate,
    latest_report_kinds: a.latestReportKinds,
    flag_counts: { critical: count("critical"), warning: count("warning"), info: count("info") },
    flags: a.flags.map((f) => ({ id: f.id, severity: f.severity, type: f.type, resource: f.resource, message: f.message })),
    latest_readings: a.latestReadings.map((r) => ({
      resource: r.resource, raw_text: r.raw_text, value: r.value, unit: r.unit, status: r.status,
      approximate: r.approximate, report_kind: r.report_kind, verified: r.verified,
    })),
    forecasts: a.forecasts.map((f) => ({
      resource: f.resource,
      latest_value: f.latest?.value ?? null, // ?. = undefined if latest is null; ?? null turns that into null
      unit: f.latest?.unit ?? null,
      latest_date: f.latest?.date ?? null,
      rate_per_day: f.rate_per_day,
      days_to_empty: f.days_to_empty,
      points_used: f.points_used,
      reason: f.reason,
    })),
    questions_to_mission_support: a.questions.map((q) => ({ text: q.text, report_kind: q.report_kind, verified: q.verified })),
    water_status_mode: a.water.mode, // details: get_water_status
  };
}

/** get_resource_history: one resource's chart series, without the per-day evidence lists. */
export function getResourceHistory(a: Analysis, resource: string) {
  const s = a.series.find((x) => x.resource === resource);
  // An error object (not a throw) goes back to Gemini, so it can correct itself and try again.
  if (!s) return { error: `no series for "${resource}"`, available: a.series.map((x) => x.resource) };
  return {
    resource,
    points: s.points.map((p) => ({
      date: p.date, raw_text: p.raw_text, value: p.value, unit: p.unit, status: p.status, approximate: p.approximate,
      change_from_previous: p.change_from_previous, change_per_day: p.change_per_day, refill: p.refill, report_kind: p.report_kind,
    })),
  };
}

/** get_flag_evidence: one flag with every quote behind it (each tagged engineering/commander). */
export function getFlagEvidence(a: Analysis, flagId: string) {
  const f = a.flags.find((x) => x.id === flagId);
  if (!f) return { error: `no flag "${flagId}"`, available: a.flags.map((x) => x.id) };
  return f;
}

/** get_water_status: water.ts's WaterStatus as is (its `mode` says which fields it has). */
export function getWaterStatus(a: Analysis) {
  return a.water;
}

/**
 * Runs one read-only tool by name.
 * @param args  Gemini's arguments for the call (unchecked JSON, so each field is checked here).
 * @returns     The JSON result to send back, or { error } for an unknown tool.
 * Why it exists: loop.ts dispatches every non-submit call through this one switch.
 */
export function runTool(a: Analysis, name: string, args: Record<string, unknown>): unknown {
  // String(x ?? "") makes a missing or non-string argument a string, so lookups just fail cleanly.
  switch (name) {
    case "get_overview":
      return getOverview(a);
    case "get_resource_history":
      return getResourceHistory(a, String(args.resource ?? ""));
    case "get_flag_evidence":
      return getFlagEvidence(a, String(args.flag_id ?? ""));
    case "get_water_status":
      return getWaterStatus(a);
    default:
      return { error: `unknown tool "${name}"` };
  }
}

/** Shortens text for the trace panel: at most `max` characters, with "…" if cut. */
const clip = (s: string, max = 160) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

/** One-line summary of a tool's arguments for the trace ("(none)" when it takes none). */
export function summarizeInput(args: Record<string, unknown>): string {
  return Object.keys(args).length === 0 ? "(none)" : clip(JSON.stringify(args));
}

/**
 * One-line summary of a tool's output for the trace panel.
 * Why it exists: the UI shows "how it got there" without dumping whole JSON objects.
 */
export function summarizeOutput(name: string, output: unknown): string {
  // `as` tells TypeScript the shape we know runTool returned for this tool name.
  const o = output as Record<string, unknown>;
  if (typeof o.error === "string") return clip(`error: ${o.error}`);
  switch (name) {
    case "get_overview": {
      const v = output as ReturnType<typeof getOverview>;
      const c = v.flag_counts;
      return clip(`${v.report_count} reports, latest ${v.latest_report_date} (${v.latest_report_kinds.join(" + ")}); ` +
        `${v.flags.length} flags: ${c.critical} critical, ${c.warning} warning, ${c.info} info; ${v.latest_readings.length} readings`);
    }
    case "get_resource_history": {
      const v = output as { resource: string; points: { raw_text: string | null }[] };
      const written = v.points.map((p) => p.raw_text ?? "—").join(" → "); // "—" marks a day with no reading
      return clip(`${v.resource}: ${v.points.length} days: ${written}`);
    }
    case "get_flag_evidence": {
      const v = output as { id: string; severity: string; evidence: { report_kind: string; quote: string }[] };
      const quotes = v.evidence.map((e) => `"${e.quote}" (${e.report_kind})`).join("; ");
      return clip(`${v.id} [${v.severity}]: ${quotes}`);
    }
    case "get_water_status": {
      const w = output as Analysis["water"]; // Analysis["water"] = the WaterStatus type
      /** Litres rounded for the one-line summary. */
      const L = (x: number) => `${Math.round(x)} L`;
      if (w.mode === "none") return clip(`none: ${w.reason}`);
      if (w.mode === "since_refill") {
        const draw = w.estimated_draw_since_refill.map((d) => `${d.id} ~${L(d.used_l)} used`).join(", ");
        return clip(`since ${w.refill.date} refill (${w.refill.days_since_refill} d): ${w.measured_trend?.description ?? "no trend"}; ${draw}`);
      }
      const left = w.scenarios.map((s) => `${s.id} ${L(s.remaining_l)} left → ${s.runs_out_on}`).join(", ");
      return clip(`projected from ${w.estimate.approximate ? "~" : ""}${w.estimate.volume_l} L on ${w.estimate.reading_date} (${w.estimate.days_since_estimate} d old); ${left}`);
    }
    default:
      return clip(JSON.stringify(output));
  }
}
