// scripts/build-demo.ts — writes the demo's analysis fixtures from the saved extractions.
// Usage: npm run build-demo
//
// How it fits: data/demo/manifest.json says which crew the demo uses, which day is preloaded and
// which day is "uploaded" live. This script runs analyzeCrew() (the same function the UI calls) for
// both days and saves the REAL output as data/demo/analysis-<date>.json, so the UI and agent can be
// built against fixed files. Re-run it whenever the analysis code or extractions change.
// Node only (fs/path), so it lives in scripts/.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { CREWS } from "../src/lib/constants.ts";
import { loadSavedForReports } from "./save-extraction.ts";

const DEMO_DIR = join("data", "demo");

// The manifest's shape, checked on load so a typo fails loudly instead of producing a wrong demo.
const ManifestSchema = z.object({
  crew: z.string(),
  preload_through: z.string(),
  upload_day: z.string(),
  upload_files: z.array(z.string()),
});

const manifest = ManifestSchema.parse(JSON.parse(readFileSync(join(DEMO_DIR, "manifest.json"), "utf8")));
const crew = CREWS[manifest.crew];
if (!crew) throw new Error(`Unknown crew "${manifest.crew}" in manifest.json (add it to CREWS in src/lib/constants.ts)`);

const extractions = loadSavedForReports(join("data", "reports", manifest.crew));
for (const asOf of [manifest.preload_through, manifest.upload_day]) {
  const outPath = join(DEMO_DIR, `analysis-${asOf}.json`);
  writeFileSync(outPath, JSON.stringify(analyzeCrew(extractions, asOf, crew), null, 2) + "\n");
  console.log(`Saved ${outPath}`);
}
