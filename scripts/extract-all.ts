// scripts/extract-all.ts — extracts every report in a folder, then writes a format survey.
// Usage: npm run extract-all -- data/reports/crew-147 [--force]
//
// How it fits: this builds the fixed record (data/extractions/*.json) that replay mode and
// `npm run analyze` read. Reports that already have a saved JSON are skipped unless --force is
// given, because Gemini's output varies between runs and the saved file is what the demo relies on.
//
// The survey (data/extractions/<crew>-survey.md) shows raw_text exactly as extracted, one row per
// report and one column per resource. We read it before writing normalize.ts so the normalization
// rules match how the crew actually wrote things, not how we imagine they did.

import { readdirSync, existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { extractAndSave, loadSaved, savedPathFor, EXTRACTIONS_DIR } from "./save-extraction.ts";
import { ReadingSchema, type SavedExtraction } from "../src/lib/schema.ts";

const args = process.argv.slice(2); // drop "node" and the script path
const force = args.includes("--force");
const reportsDir = args.find((a) => !a.startsWith("--")); // the one argument that isn't a flag
if (!reportsDir) {
  console.error("Usage: npm run extract-all -- <reports-folder> [--force]");
  process.exit(1);
}
process.loadEnvFile(".env"); // GEMINI_API_KEY and GEMINI_MODEL

const files = readdirSync(reportsDir).filter((f) => f.endsWith(".txt")).sort(); // date-prefixed names sort by date
const results: SavedExtraction[] = [];
let failures = 0;

// One report at a time (not in parallel) so we stay under Gemini's rate limit.
for (const file of files) {
  const reportPath = join(reportsDir, file);
  const outPath = savedPathFor(reportPath);
  if (existsSync(outPath) && !force) {
    console.log(`skip    ${file} (saved JSON exists)`);
    results.push(loadSaved(outPath));
    continue;
  }
  try {
    console.log(`extract ${file} ...`);
    results.push(await extractAndSave(reportPath));
  } catch (err) {
    // Keep going so one bad report doesn't block the rest; the survey shows which are missing.
    failures++;
    console.error(`FAILED  ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Survey table -------------------------------------------------------------------------------
// ReadingSchema.shape.resource.options is zod's list of enum values: every resource we know about.
const resources = ReadingSchema.shape.resource.options;

/** Escapes a cell for a Markdown table: "|" would start a new column, newlines would end the row. */
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

const header = ["date", "file", ...resources, "unverified"];
const rows = results.map((x) => {
  const cols = resources.map((res) => {
    const rs = x.readings.filter((r) => r.resource === res);
    // Several readings of one resource on a day are joined with " / "; unverified ones get a ✗ mark.
    return rs.map((r) => cell(r.raw_text) + (r.verified ? "" : " ✗")).join(" / ") || "—";
  });
  const unverified = [...x.readings, ...x.events, ...x.questions_to_mission_support].filter((i) => !i.verified).length;
  return [x.date + (x.date_from_filename ? "*" : ""), x.source_file, ...cols, String(unverified)];
});

const table = [
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...rows.map((r) => `| ${r.join(" | ")} |`),
].join("\n");

// The crew name for the filename comes from the folder name (data/reports/crew-147 -> crew-147).
const crew = basename(reportsDir);
const surveyPath = join(EXTRACTIONS_DIR, `${crew}-survey.md`);
const doc = `# ${crew} format survey

raw_text exactly as Gemini extracted it. "—" = no reading of that resource. ✗ = quote not verified.
\\* = date taken from the filename. "unverified" counts readings + events + questions.

${table}
`;
writeFileSync(surveyPath, doc);
console.log(`\n${table}\n`);
console.log(`Saved ${surveyPath}  (${results.length} reports, ${failures} failed)`);
if (failures > 0) process.exit(1);
