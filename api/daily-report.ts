// api/daily-report.ts — Vercel serverless function: POST every extraction + a date, get the agent's report.
//
// How it fits: after an upload, the UI sends the full list of extractions (preloaded + uploaded) and
// the as-of date. We run the same pipeline as `npm run daily-report`: analyzeCrew() → the agent
// (runDailyReport: Gemini with tools, then our grounding check). The response includes the Analysis
// too, so the UI renders the dashboard and the report from one consistent result.
// Web-standard POST(request) handler, like api/extract.ts. Server-only (uses the Gemini key).

import { ApiError } from "@google/genai";
import { z } from "zod";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { CREW_147 } from "../src/lib/constants.ts";
import { SavedExtractionSchema } from "../src/lib/schema.ts";
import { runDailyReport } from "../src/lib/agent/loop.ts";

// maxDuration (seconds): the agent makes up to 7 Gemini calls (5 turns, 1 forced submit, 1 validation
// retry), each 10–30s plus retry waits, so we allow 300s — the Hobby plan's maximum with fluid compute.
export const config = { maxDuration: 300 };

// Regex: exactly YYYY-MM-DD. analyzeCrew compares dates as strings, so the format must be exact.
const BodySchema = z.object({
  extractions: z.array(SavedExtractionSchema),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST { extractions, as_of } → { analysis, report, trace }
 * 400 for a bad body; 502 if Gemini fails or never submits a valid report.
 */
export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch (err) {
    // A zod error lists exactly which field is wrong; a JSON error just says it isn't JSON.
    const detail = err instanceof z.ZodError ? err.message : "body is not valid JSON";
    return Response.json({ error: `body must be { extractions: SavedExtraction[], as_of: "YYYY-MM-DD" }: ${detail.slice(0, 500)}` }, { status: 400 });
  }

  // The demo has one crew; its config comes from constants.ts, never from the extractions.
  const analysis = analyzeCrew(body.extractions, body.as_of, CREW_147);
  try {
    const { report, trace } = await runDailyReport(analysis);
    return Response.json({ analysis, report, trace });
  } catch (err) {
    const detail = err instanceof ApiError ? `Gemini API error ${err.status}` : String(err instanceof Error ? err.message : err);
    return Response.json({ error: `daily report failed: ${detail.slice(0, 500)}` }, { status: 502 });
  }
}
