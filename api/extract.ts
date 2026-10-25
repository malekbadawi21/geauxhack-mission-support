// api/extract.ts — Vercel serverless function: POST one report's text, get back its verified extraction.
//
// How it fits: the UI's upload button sends { filename, text }. We run the same steps as the CLI
// (scripts/save-extraction.ts): Gemini reads the report (extract.ts), our code checks every quote
// (verify.ts) and normalizes the date (dates.ts). The UI appends the returned extraction to the list
// it already has and calls analyzeCrew() — nothing is saved on the server.
//
// Vercel runs any file in api/ as a function. Exporting POST(request) uses the Web-standard Request /
// Response objects (built into Node 18+), so we need no Vercel-specific package. Server-only: this is
// where the Gemini key is used, so it never reaches the browser.

import { ApiError } from "@google/genai";
import { z } from "zod";
import { extractReport } from "../src/lib/extract.ts";
import { verifyQuotes } from "../src/lib/verify.ts";
import { resolveReportDate } from "../src/lib/dates.ts";
import type { SavedExtraction } from "../src/lib/schema.ts";

// maxDuration (seconds) is how long Vercel lets this function run before killing it. One Gemini call
// takes 10–30s and extract.ts may retry 3 times (waits of 2+4+8s), so we allow 300s — the Hobby
// plan's maximum with fluid compute. (Vercel reads this `config` export from Node /api functions.)
export const config = { maxDuration: 300 };

// Our choice: 50 KB of text is far more than any MDRS report (they're 2–5 KB); bigger is a wrong file.
const MAX_TEXT_BYTES = 50_000;

const BodySchema = z.object({ filename: z.string(), text: z.string() });

/**
 * Decides whether a report is an engineering or commander report: from the filename first, then
 * from the report's first lines (its title). Returns null if neither says.
 * Why only the first lines: commander reports mention "engineering report" in their body.
 */
export function inferKind(filename: string, text: string): "engineering" | "commander" | null {
  // Regex /commander/i: the word anywhere, any case.
  for (const s of [filename, text.slice(0, 200)]) {
    if (/commander/i.test(s)) return "commander";
    if (/engineering/i.test(s)) return "engineering";
  }
  return null;
}

/** A JSON error response. Response.json(body, init) is the Web-standard way to send JSON. */
const fail = (status: number, error: string) => Response.json({ error }, { status });

/**
 * POST { filename, text } → { extraction, verification, report_date, kind }
 * 400 for a bad body, empty or oversized text, or no date/kind; 502 if Gemini fails after retries.
 */
export async function POST(request: Request): Promise<Response> {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json()); // throws on non-JSON or a wrong shape
  } catch {
    return fail(400, "body must be JSON: { filename: string, text: string }");
  }
  const { filename, text } = body;
  if (text.trim() === "") return fail(400, "text is empty");
  // TextEncoder turns the string into UTF-8 bytes, so "¾" counts as the 2 bytes it really is.
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) return fail(400, `text is larger than ${MAX_TEXT_BYTES / 1000} KB`);
  const kind = inferKind(filename, text);
  if (!kind) return fail(400, 'can\'t tell the report kind: put "engineering" or "commander" in the filename');

  let verified;
  try {
    verified = verifyQuotes(text, await extractReport(text));
  } catch (err) {
    // ApiError = Gemini answered with an HTTP error (after extract.ts's retries); anything else is a
    // reply that wasn't valid JSON or didn't fit the schema. Both are Gemini's side, hence 502.
    const detail = err instanceof ApiError ? `Gemini API error ${err.status}` : String(err instanceof Error ? err.message : err);
    return fail(502, `extraction failed: ${detail.slice(0, 500)}`);
  }

  let date: string, fromFilename: boolean;
  try {
    ({ date, fromFilename } = resolveReportDate(verified.report_date, filename)); // ({ a } = obj) assigns existing variables
  } catch (err) {
    return fail(400, (err as Error).message);
  }

  // source_file is canonical "<date>-<kind>.txt" because analyzeCrew reads the report kind from it
  // (reportKindOf), whatever the uploaded file was called.
  const extraction: SavedExtraction = { ...verified, date, date_from_filename: fromFilename, source_file: `${date}-${kind}.txt` };
  const items = [...verified.readings, ...verified.events, ...verified.questions_to_mission_support];
  const verification = {
    total: items.length,
    verified: items.filter((x) => x.verified).length,
    unverified_quotes: items.filter((x) => !x.verified).map((x) => x.source_quote),
  };
  return Response.json({ extraction, verification, report_date: date, kind });
}
