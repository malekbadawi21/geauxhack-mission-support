// Usage: npm run extract -- <path-to-report.txt>
// Runs one report through Gemini, verifies the quotes, prints a summary, and saves the JSON.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { extractReport } from "../src/lib/extract.ts";
import { verifyQuotes } from "../src/lib/verify.ts";

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: npm run extract -- <path-to-report.txt>");
  process.exit(1);
}

process.loadEnvFile(".env"); // built into Node 20.12+, so no dotenv package needed

const text = readFileSync(reportPath, "utf8");
const extraction = await extractReport(text);
const result = verifyQuotes(text, extraction);

console.log(`\nReport: ${reportPath}`);
console.log(`Date: ${result.report_date ?? "(missing)"}   Crew: ${result.crew ?? "(missing)"}   Author: ${result.author ?? "(missing)"}`);

console.log("\nREADINGS");
console.table(
  result.readings.map((r) => ({
    resource: r.resource,
    raw_text: r.raw_text,
    value: r.value,
    unit: r.unit,
    measured_from: r.measured_from,
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

const unverified =
  result.readings.filter((r) => !r.verified).length + result.events.filter((e) => !e.verified).length;
console.log(`\nUnverified items: ${unverified}`);

// Save next to the other extractions, using the report's filename with .json.
const outDir = join("data", "extractions");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, basename(reportPath, extname(reportPath)) + ".json");
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`Saved ${outPath}`);
