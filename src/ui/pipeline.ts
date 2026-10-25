// pipeline.ts — the upload pipeline's types, plus the two Live-mode calls to our own API.
//
// How it fits: App.tsx runs the pipeline stages (Reading reports → Verifying quotes → Updating
// analysis → Agent investigating → Daily report ready) and PipelinePanel.tsx draws them. In Replay
// mode the results come from saved files (data.ts); in Live mode they come from the Phase 3b
// serverless functions /api/extract and /api/daily-report, called here. These are our own endpoints
// (the Gemini key stays on the server); no third-party service is called from the browser.
//
// Phase 3b is built in parallel, so the responses are validated with the frozen zod schemas and any
// mismatch becomes a plain error message the UI shows (with "Switch to replay").

import { SavedExtractionSchema, VerifiedExtractionSchema, type SavedExtraction } from "../lib/schema.ts";
import { AgentTraceStepSchema, DailyReportSchema, type DemoRun } from "../lib/report-types.ts";
import { dateFromFilename, normalizeDate } from "../lib/dates.ts";

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

/**
 * Live: sends one report's text to /api/extract and turns the reply into a SavedExtraction.
 * @param filename  The uploaded file's name (used for the date if the report has none).
 * @param text      The report text.
 * @returns         The extraction in the same saved shape analyzeCrew() reads from data/extractions/.
 * Reply shape (prompts/phase-3b.md): { extraction, verification, report_date, kind }. We accept the
 * verified extraction under either `extraction` or `verification`, and build the saved form ourselves.
 */
export async function liveExtract(filename: string, text: string): Promise<SavedExtraction> {
  const reply = (await postJson("/api/extract", { filename, text })) as Record<string, unknown>;
  // If the server already sent the saved form, use it as is.
  const saved = SavedExtractionSchema.safeParse(reply.extraction);
  if (saved.success) return saved.data;
  // Otherwise find the verified extraction (items carry `verified`) in whichever field holds it.
  const verified = [reply.verification, reply.extraction].map((v) => VerifiedExtractionSchema.safeParse(v)).find((r) => r.success);
  if (!verified?.data) throw new Error("/api/extract reply did not contain a verified extraction");
  const date = normalizeDate(typeof reply.report_date === "string" ? reply.report_date : null) ?? dateFromFilename(filename);
  if (!date) throw new Error(`no usable date for ${filename} (report_date: ${String(reply.report_date)})`);
  const kind = reply.kind === "commander" ? "commander" : "engineering";
  return {
    ...verified.data,
    date,
    date_from_filename: normalizeDate(typeof reply.report_date === "string" ? reply.report_date : null) === null,
    // analyzeCrew reads the report kind from source_file ("YYYY-MM-DD-<kind>.txt"), so we store the
    // canonical name even if the uploaded file was called something else.
    source_file: `${date}-${kind}.txt`,
  };
}

/**
 * Live: asks /api/daily-report for the agent's report on everything loaded so far.
 * @returns  A DemoRun-shaped record (is_sample false) so Live and Replay render the same way.
 */
export async function liveDailyReport(extractions: SavedExtraction[], asOf: string): Promise<DemoRun> {
  const reply = (await postJson("/api/daily-report", { extractions, as_of: asOf })) as Record<string, unknown>;
  const report = DailyReportSchema.safeParse(reply.report);
  if (!report.success) throw new Error(`/api/daily-report sent a report that doesn't match the contract: ${report.error.message}`);
  const trace = AgentTraceStepSchema.array().safeParse(reply.trace ?? []); // .array() = a list of that schema
  if (!trace.success) throw new Error(`/api/daily-report sent a trace that doesn't match the contract: ${trace.error.message}`);
  return {
    as_of: asOf,
    report: report.data,
    trace: trace.data,
    generated_at: new Date().toISOString(),
    model: "live run",
    is_sample: false,
  };
}
