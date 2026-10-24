// scripts/extract.ts — command-line tool for testing extraction without any UI.
// Usage: npm run extract -- <path-to-report.txt>
// Runs one report through Gemini, verifies the quotes, prints a summary, and saves the JSON.
//
// How it fits: this wires together src/lib/extract.ts (LLM call) and src/lib/verify.ts (quote check).
// The JSON it writes to data/extractions/ is reused later for demo replay mode, so the demo can run
// without calling Gemini live. It runs under `tsx`, which executes TypeScript directly in Node
// (no separate compile step).
//
// The file has no functions: it is a top-to-bottom script. Top-level `await` works because
// package.json sets "type": "module" (ES modules).

// "node:" prefix = Node's built-in modules (not npm packages).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { extractReport } from "../src/lib/extract.ts";
import { verifyQuotes } from "../src/lib/verify.ts";

// process.argv is the command line as an array: [node, script, ...args]. `npm run extract -- X`
// passes X through, so the report path is index 2.
const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: npm run extract -- <path-to-report.txt>");
  process.exit(1); // non-zero exit code = failure
}

// process.loadEnvFile reads KEY=value lines from .env into process.env (GEMINI_API_KEY, GEMINI_MODEL).
process.loadEnvFile(".env"); // built into Node 20.12+, so no dotenv package needed

const text = readFileSync(reportPath, "utf8"); // "utf8" returns a string (and keeps "¾" intact)
const extraction = await extractReport(text);
const result = verifyQuotes(text, extraction);

console.log(`\nReport: ${reportPath}`);
// `?? "(missing)"` shows missing fields as missing instead of printing "null" or guessing.
console.log(`Date: ${result.report_date ?? "(missing)"}   Crew: ${result.crew ?? "(missing)"}   Author: ${result.author ?? "(missing)"}`);

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
for (const q of result.questions_to_mission_support) console.log(`- ${q}`);

// Count readings + events that failed verification, as a one-line health check.
const unverified =
  result.readings.filter((r) => !r.verified).length + result.events.filter((e) => !e.verified).length;
console.log(`\nUnverified items: ${unverified}`);

// Save next to the other extractions, using the report's filename with .json.
// basename(path, ext) strips the folder and the extension: ".../2015-01-13-engineering.txt" -> "2015-01-13-engineering".
const outDir = join("data", "extractions");
mkdirSync(outDir, { recursive: true }); // recursive: create parent folders too, and don't fail if it exists
const outPath = join(outDir, basename(reportPath, extname(reportPath)) + ".json");
// JSON.stringify(value, null, 2) pretty-prints with 2-space indentation so the file is human-readable.
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`Saved ${outPath}`);
