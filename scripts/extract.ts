// scripts/extract.ts — command-line tool for testing extraction of ONE report without any UI.
// Usage: npm run extract -- <path-to-report.txt>
// Runs one report through Gemini, verifies the quotes, prints a summary, and saves the JSON.
//
// How it fits: the real work is in save-extraction.ts (shared with extract-all.ts). The JSON it writes
// to data/extractions/ is reused for demo replay mode, so the demo can run without calling Gemini
// live. It runs under `tsx`, which executes TypeScript directly in Node (no separate compile step).
//
// The file has no functions: it is a top-to-bottom script. Top-level `await` works because
// package.json sets "type": "module" (ES modules).

import { extractAndSave, savedPathFor } from "./save-extraction.ts";

// process.argv is the command line as an array: [node, script, ...args]. `npm run extract -- X`
// passes X through, so the report path is index 2.
const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: npm run extract -- <path-to-report.txt>");
  process.exit(1); // non-zero exit code = failure
}

// process.loadEnvFile reads KEY=value lines from .env into process.env (GEMINI_API_KEY, GEMINI_MODEL).
process.loadEnvFile(".env"); // built into Node 20.12+, so no dotenv package needed

const result = await extractAndSave(reportPath);

console.log(`\nReport: ${reportPath}`);
// `?? "(missing)"` shows missing fields as missing instead of printing "null" or guessing.
console.log(`Date: ${result.date}${result.date_from_filename ? " (from filename)" : ""}   Crew: ${result.crew ?? "(missing)"}   Author: ${result.author ?? "(missing)"}`);

console.log("\nREADINGS");
// console.table prints an array of objects as a grid; we pick only the columns worth showing
// (source_quote is left out to keep the table narrow — it's in the saved JSON).
console.table(
  result.readings.map((r) => ({
    resource: r.resource,
    raw_text: r.raw_text,
    value: r.value,
    unit: r.unit,
    measured_from: r.measured_from,
    // Loud label on purpose: an unverified reading must be impossible to miss.
    verified: r.verified ? "yes" : "NO - UNVERIFIED",
  })),
);

console.log("\nEVENTS");
for (const e of result.events) {
  const mark = e.verified ? "[verified]" : "[UNVERIFIED]";
  console.log(`- ${mark} ${e.type}: ${e.description}`);
  console.log(`    quote: "${e.source_quote}"`);
}

console.log("\nQUESTIONS TO MISSION SUPPORT");
for (const q of result.questions_to_mission_support) {
  console.log(`- ${q.verified ? "[verified]" : "[UNVERIFIED]"} ${q.text}`);
}

// Count items that failed verification, as a one-line health check.
const unverified = [...result.readings, ...result.events, ...result.questions_to_mission_support].filter(
  (x) => !x.verified,
).length;
console.log(`\nUnverified items: ${unverified}`);
console.log(`Saved ${savedPathFor(reportPath)}`);
