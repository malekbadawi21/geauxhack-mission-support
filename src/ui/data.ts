// data.ts — loads everything the UI bundles from data/: saved extractions, the demo manifest, the
// recorded agent runs, and (on demand) the raw report texts.
//
// How it fits: the browser can't read files, so Vite's import.meta.glob pulls the JSON into the
// bundle at build time. Each file is validated with the same zod schemas the scripts use, so a
// malformed file fails loudly at startup instead of rendering wrong numbers. App.tsx then feeds these
// extractions to analyzeCrew(). No network: everything here ships inside the app (CLAUDE.md rule).

import { SavedExtractionSchema, type SavedExtraction } from "../lib/schema.ts";
import { DemoRunSchema, type DemoRun } from "../lib/report-types.ts";

// import.meta.glob(pattern, { eager: true, import: "default" }) is a Vite feature: at build time it
// finds every matching file and returns { "path": fileContents }. eager = load now (not lazily);
// import: "default" = give us the parsed JSON itself. The 2015-* pattern skips the CLI's
// crew-147-analysis-*.json outputs that live in the same folder.
const extractionFiles = import.meta.glob("../../data/extractions/2015-*.json", { eager: true, import: "default" });
const demoFiles = import.meta.glob("../../data/demo/*.json", { eager: true, import: "default" });

// Report texts are only needed in Live mode (to POST to /api/extract), so they load lazily:
// without eager, each value is a function returning a Promise. query "?raw" = the file as a string.
const reportTexts = import.meta.glob("../../data/reports/*/2015-*.txt", { query: "?raw", import: "default" });

/** Every saved extraction (all report kinds, all days), validated, oldest first. */
export const ALL_EXTRACTIONS: SavedExtraction[] = Object.values(extractionFiles)
  .map((json) => SavedExtractionSchema.parse(json)) // .parse throws if the file doesn't match the schema
  .sort((a, b) => a.date.localeCompare(b.date) || a.source_file.localeCompare(b.source_file));

// The demo setup written by Phase 3a. Small enough to describe by hand instead of a zod schema.
export type DemoManifest = { crew: string; preload_through: string; upload_day: string; upload_files: string[] };

/** Finds one file in demoFiles by its name, or throws (the demo can't run without it). */
function demoFile(name: string): unknown {
  // Object.entries gives [path, contents] pairs; the glob keys are relative paths like "../../data/demo/x.json".
  const hit = Object.entries(demoFiles).find(([path]) => path.endsWith(`/${name}`));
  if (!hit) throw new Error(`data/demo/${name} is missing`);
  return hit[1];
}

export const MANIFEST = demoFile("manifest.json") as DemoManifest; // `as`: trusted file we wrote ourselves

/** Recorded agent runs by as-of date (one per report day, Phase 6 Part C), each validated against the contract. */
export const DEMO_RUNS: Record<string, DemoRun> = Object.fromEntries(
  Object.entries(demoFiles)
    .filter(([path]) => /\/run-[\d-]+\.json$/.test(path)) // regex: "/run-" + date digits/dashes + ".json"
    .map(([, json]) => DemoRunSchema.parse(json))
    .map((run) => [run.as_of, run]),
);

/** The history the demo starts with: every report dated on or before manifest.preload_through. */
export const PRELOADED: SavedExtraction[] = ALL_EXTRACTIONS.filter((x) => x.date <= MANIFEST.preload_through);

/** Finds the saved extraction for a report filename (replay mode recognizes uploads this way). */
export function savedExtractionFor(filename: string): SavedExtraction | undefined {
  return ALL_EXTRACTIONS.find((x) => x.source_file === filename);
}

/**
 * Loads a bundled report's text by filename, e.g. "2015-01-13-engineering.txt".
 * @returns  The text, or null if no bundled report has that name.
 * Why it exists: the "use demo files" button in Live mode sends the real report text to /api/extract.
 */
export async function bundledReportText(filename: string): Promise<string | null> {
  const hit = Object.entries(reportTexts).find(([path]) => path.endsWith(`/${filename}`));
  return hit ? ((await hit[1]()) as string) : null;
}

/**
 * Counts how many quotes in one extraction were found verbatim in its report.
 * @returns  { verified, total } over readings, events and questions.
 * Why it exists: the "Verifying quotes" pipeline stage shows this per file.
 */
export function quoteCounts(x: SavedExtraction): { verified: number; total: number } {
  const items = [...x.readings, ...x.events, ...x.questions_to_mission_support];
  return { verified: items.filter((i) => i.verified).length, total: items.length };
}
