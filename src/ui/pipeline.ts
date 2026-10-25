// pipeline.ts — the upload pipeline's types, plus the two Live-mode calls to our own API.
//
// How it fits: App.tsx runs the pipeline stages (Reading reports → Verifying quotes → Updating
// analysis → Agent investigating → Daily report ready) and PipelinePanel.tsx draws them. In Replay
// mode the results come from saved files (data.ts); in Live mode they come from the Phase 3b
// serverless functions /api/extract and /api/daily-report, called here. These are our own endpoints
// (the Gemini key stays on the server); no third-party service is called from the browser.
//
// Each reply is validated with a zod schema matching exactly what api/extract.ts and
// api/daily-report.ts send, so a mismatch becomes a plain error message the UI shows (with
// "Switch to replay") instead of a half-rendered dashboard.

import { z } from "zod";
import { SavedExtractionSchema, type SavedExtraction } from "../lib/schema.ts";
import { AgentTraceStepSchema, DailyReportSchema, type DemoRun } from "../lib/report-types.ts";

export type Mode = "replay" | "live";

export type StageId = "reading" | "verifying" | "analyzing" | "agent" | "ready";

// The stages in order, with the label shown for each.
export const STAGES: { id: StageId; label: string }[] = [
  { id: "reading", label: "Reading reports" },
  { id: "verifying", label: "Verifying quotes" },
  { id: "analyzing", label: "Updating analysis" },
  { id: "agent", label: "Agent investigating" },
  { id: "ready", label: "Daily report ready" },
];

// One uploaded file. readText is a function so Replay mode never has to read the file at all.
export type UploadFile = { name: string; readText: () => Promise<string> };

// What the pipeline panel shows while (and after) a run.
export type PipelineState = {
  mode: Mode;
  files: string[];
  stage: StageId;
  fileNotes: Record<string, string>; // per-file line under "Reading reports" / "Verifying quotes"
  analysisNote: string | null; // line under "Updating analysis"
  run: DemoRun | null; // the agent run being revealed (null = none recorded / not back yet)
  traceShown: number; // how many trace steps are visible so far
  note: string | null; // a final remark, e.g. "no recorded agent run for this date"
  error: string | null; // set when a Live call failed; the panel offers "Switch to replay"
};

/** Waits `ms` milliseconds. Used only to pace the replay animation. */
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POSTs JSON to one of our API routes and returns the parsed reply.
 * @throws  An Error with the HTTP status and the server's message, so the UI can show it plainly.
 */
async function postJson(url: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    // fetch only rejects when the request never got an answer (offline, server not running).
    throw new Error(`${url}: no response (${e instanceof Error ? e.message : String(e)})`);
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Not JSON (e.g. an HTML 404 page from a static host with no API): keep json null.
  }
  if (!res.ok) {
    // Show the server's { error } message if it sent one, else the first part of the raw body.
    const msg = (json as { error?: unknown } | null)?.error;
    throw new Error(`${url} returned ${res.status}: ${typeof msg === "string" ? msg : text.slice(0, 200) || res.statusText}`);
  }
  if (json === null) throw new Error(`${url} did not return JSON`);
  return json;
}

// What /api/extract replies with. The server already builds the saved form (canonical source_file,
// normalized date), so `extraction` is used as is. `verification` holds counts for logging; the UI
// counts quotes itself from the extraction (quoteCounts in data.ts). z.object ignores extra keys.
const ExtractReplySchema = z.object({
  extraction: SavedExtractionSchema,
  verification: z.object({ total: z.number(), verified: z.number(), unverified_quotes: z.array(z.string()) }),
  report_date: z.string(),
  kind: z.enum(["engineering", "commander"]),
});

// What /api/daily-report replies with. It also sends `analysis`, but App.tsx computes the same
// Analysis itself with analyzeCrew() on the same extractions, so we only take the report and trace.
const DailyReportReplySchema = z.object({
  report: DailyReportSchema,
  trace: z.array(AgentTraceStepSchema),
});

/**
 * Live: sends one report's text to /api/extract and returns its verified extraction.
 * @param filename  The uploaded file's name (the server uses it for the kind, and the date if the
 *                  report has none).
 * @param text      The report text.
 * @returns         The extraction in the same saved shape analyzeCrew() reads from data/extractions/.
 */
export async function liveExtract(filename: string, text: string): Promise<SavedExtraction> {
  const reply = ExtractReplySchema.safeParse(await postJson("/api/extract", { filename, text }));
  if (!reply.success) throw new Error(`/api/extract sent a reply that doesn't match the contract: ${reply.error.message}`);
  return reply.data.extraction;
}

/**
 * Live: asks /api/daily-report for the agent's report on everything loaded so far.
 * @returns  A DemoRun-shaped record (is_sample false) so Live and Replay render the same way.
 */
export async function liveDailyReport(extractions: SavedExtraction[], asOf: string): Promise<DemoRun> {
  const reply = DailyReportReplySchema.safeParse(await postJson("/api/daily-report", { extractions, as_of: asOf }));
  if (!reply.success) throw new Error(`/api/daily-report sent a reply that doesn't match the contract: ${reply.error.message}`);
  return {
    as_of: asOf,
    report: reply.data.report,
    trace: reply.data.trace,
    generated_at: new Date().toISOString(),
    model: "live run",
    is_sample: false,
  };
}
