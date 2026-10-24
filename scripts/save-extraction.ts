// scripts/save-extraction.ts — shared helpers for the CLI scripts: turn one report file into a
// SavedExtraction on disk, and load saved extractions back.
//
// How it fits: both `npm run extract` (one report) and `npm run extract-all` (a folder) need the same
// steps: read file → Gemini (extract.ts) → quote check (verify.ts) → date (dates.ts) → write JSON.
// Keeping them here means the two scripts can't drift apart. This file uses fs/path, so it lives in
// scripts/ (Node only), never in src/lib/ (which must run in the browser).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { extractReport } from "../src/lib/extract.ts";
import { verifyQuotes } from "../src/lib/verify.ts";
import { resolveReportDate } from "../src/lib/dates.ts";
import { SavedExtractionSchema, type SavedExtraction } from "../src/lib/schema.ts";
import { reportKindOf } from "../src/lib/normalize.ts";

export const EXTRACTIONS_DIR = join("data", "extractions");

/**
 * True for report files we extract: "YYYY-MM-DD-<kind>.txt". Reference files without a date prefix
 * (e.g. final-mission-report.txt) are skipped. Regex: 4-2-2 digits, a dash, a word, ".txt".
 */
export function isDatedReport(file: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-[a-z]+\.txt$/.test(file);
}

/** The report kind from its filename: "2015-01-13-commander.txt" -> "commander" (shared with the app). */
export const reportKind = reportKindOf;

/**
 * Where the saved JSON for a report goes: data/extractions/<report name>.json.
 * basename(path, ext) strips the folder and the extension: ".../2015-01-13-engineering.txt" -> "2015-01-13-engineering".
 */
export function savedPathFor(reportPath: string): string {
  return join(EXTRACTIONS_DIR, basename(reportPath, extname(reportPath)) + ".json");
}

/**
 * Runs one report through Gemini, verifies its quotes, resolves its date, and writes the JSON.
 * @param reportPath  Path to a .txt report.
 * @returns           The SavedExtraction that was written.
 * Why it exists: the one place a report becomes our fixed record for replay mode.
 */
export async function extractAndSave(reportPath: string): Promise<SavedExtraction> {
  const text = readFileSync(reportPath, "utf8"); // "utf8" returns a string (and keeps "¾" intact)
  const extraction = await extractReport(text);
  const verified = verifyQuotes(text, extraction);
  const file = basename(reportPath);
  const { date, fromFilename } = resolveReportDate(verified.report_date, file);
  // Warn (don't silently pick one) if the report's own date disagrees with the filename.
  if (!fromFilename && !file.includes(date)) {
    console.warn(`  ! ${file}: report says ${date}, filename disagrees — using the report's date`);
  }
  const saved: SavedExtraction = { ...verified, date, date_from_filename: fromFilename, source_file: file };
  mkdirSync(EXTRACTIONS_DIR, { recursive: true }); // create the folder if missing; no error if it exists
  // JSON.stringify(value, null, 2) pretty-prints with 2-space indentation so the file is human-readable.
  writeFileSync(savedPathFor(reportPath), JSON.stringify(saved, null, 2) + "\n");
  return saved;
}

/**
 * Loads one saved extraction and checks it still matches the current schema.
 * @throws  With the file name if it doesn't (e.g. saved before a schema change — re-run with --force).
 */
export function loadSaved(path: string): SavedExtraction {
  const parsed = SavedExtractionSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`${path} does not match SavedExtractionSchema:\n${parsed.error.message}`);
  return parsed.data;
}

/**
 * Loads the saved extraction for every dated report in a folder (reports without one are skipped).
 * @param reportsDir  e.g. data/reports/crew-147
 * @param kind        Only this report kind (e.g. "engineering"); omit for all kinds.
 * @returns           SavedExtractions in filename order (filenames start with the date).
 */
export function loadSavedForReports(reportsDir: string, kind?: string): SavedExtraction[] {
  return readdirSync(reportsDir)
    .filter(isDatedReport)
    .filter((f) => kind === undefined || reportKind(f) === kind)
    .sort()
    .map((f) => savedPathFor(f))
    .filter((p) => existsSync(p))
    .map(loadSaved);
}
