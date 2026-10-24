// report-types.ts — the data contract for the agent's output (FROZEN as of Phase 3a).
//
// How it fits: Phase 3b's agent (api/) reads an Analysis from analyzeCrew() and writes a DailyReport;
// Phase 4's UI renders it. Both sides import these schemas, so they agree on the shape without
// talking to each other. Like schema.ts, each zod schema is used to validate at runtime (never trust
// an LLM's JSON blindly) and to derive the TypeScript type, so the two can't drift apart.
// data/demo/run-2015-01-13.json is a DemoRun saved in this shape. Browser-safe.

import { z } from "zod";

// Malek's limit for the message to Earth: short enough to read in under a minute.
export const MESSAGE_TO_EARTH_MAX_WORDS = 120;

/** Counts words: runs of non-space characters. Regex /\S+/g = every run of non-whitespace. */
export const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;

// The agent's daily report for one as-of date.
export const DailyReportSchema = z.object({
  as_of: z.string(), // YYYY-MM-DD, same as Analysis.asOf
  overall: z.enum(["nominal", "caution", "critical"]),
  status_line: z.string(), // one sentence
  // Each concern points at the flags (by Flag.id) that back it up, so every claim traces to a rule.
  concerns: z.array(z.object({ title: z.string(), detail: z.string(), flag_ids: z.array(z.string()) })),
  crew_actions: z.array(z.string()), // what the crew can do now, without waiting for Earth
  decisions_for_earth: z.array(z.object({ decision: z.string(), why: z.string() })), // only what a human on Earth must decide
  // .refine(check, message) adds a custom rule zod runs after the type check.
  message_to_earth: z
    .string()
    .refine((s) => countWords(s) <= MESSAGE_TO_EARTH_MAX_WORDS, `message_to_earth must be at most ${MESSAGE_TO_EARTH_MAX_WORDS} words`), // self-contained
  // Our code's check that every number in the report appears in the Analysis.
  grounding: z.object({
    numbers_checked: z.number(), // how many numbers in the report text were checked
    ungrounded: z.array(z.string()), // numbers not found in the Analysis (should be empty)
  }),
});

// One step of the agent's work (a tool call), for the "how it got there" panel in the UI.
export const AgentTraceStepSchema = z.object({
  step: z.number(), // 1, 2, 3, ...
  tool: z.string(), // the tool's name
  input_summary: z.string(),
  output_summary: z.string(),
  ms: z.number(), // how long the step took, in milliseconds
});

// A saved agent run: what the demo replays when Gemini isn't called live.
export const DemoRunSchema = z.object({
  as_of: z.string(),
  report: DailyReportSchema,
  trace: z.array(AgentTraceStepSchema),
  generated_at: z.string(), // ISO timestamp of the run
  model: z.string(), // the Gemini model that produced it (or a note that it's hand-written)
  is_sample: z.boolean(), // true = hand-written placeholder, not a real agent run
});

// z.infer turns each schema into its TypeScript type (see schema.ts).
export type DailyReport = z.infer<typeof DailyReportSchema>;
export type AgentTraceStep = z.infer<typeof AgentTraceStepSchema>;
export type DemoRun = z.infer<typeof DemoRunSchema>;
