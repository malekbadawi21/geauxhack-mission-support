// scripts/daily-report.ts — runs the agent from the command line and saves the run for demo replay.
// Usage: npm run daily-report -- crew-147 --as-of 2015-01-13
//
// How it fits: the same pipeline as api/daily-report.ts (saved extractions → analyzeCrew → agent →
// grounding check), without a server. It prints the report, the trace and the grounding result, and
// writes a real DemoRun to data/demo/run-<date>.json (is_sample: false). That file is the fixed
// record the UI replays, so the demo never depends on Gemini being up. Node only (fs/path).

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { CREWS } from "../src/lib/constants.ts";
import { DemoRunSchema, countWords, type DemoRun } from "../src/lib/report-types.ts";
import { runDailyReport } from "../src/lib/agent/loop.ts";
import { loadSavedForReports } from "./save-extraction.ts";

// process.argv = [node, script, ...args]; we expect: <crew> --as-of <YYYY-MM-DD>
const args = process.argv.slice(2);
const crewName = args[0];
const asOf = args[args.indexOf("--as-of") + 1]; // indexOf is -1 if missing → args[0], caught by the regex below
const crew = crewName ? CREWS[crewName] : undefined;
// Regex: exactly YYYY-MM-DD.
if (!crew || !asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error("Usage: npm run daily-report -- <crew, e.g. crew-147> --as-of YYYY-MM-DD");
  process.exit(1);
}

process.loadEnvFile(".env"); // GEMINI_API_KEY, GEMINI_MODEL (Node built-in, see scripts/extract.ts)

const analysis = analyzeCrew(loadSavedForReports(join("data", "reports", crewName)), asOf, crew);
console.log(`Running agent for ${crew.name} as of ${asOf} (${analysis.reportCount} reports, ${analysis.flags.length} flags)…`);
const { report, trace, model } = await runDailyReport(analysis);

console.log("\nTRACE");
// console.table prints one row per step.
console.table(trace.map((t) => ({ step: t.step, tool: t.tool, input: t.input_summary, output: t.output_summary, ms: t.ms })));

console.log(`\nREPORT (${report.overall.toUpperCase()})`);
console.log(report.status_line);
console.log("\nConcerns:");
for (const c of report.concerns) console.log(`- ${c.title} [${c.flag_ids.join(", ")}]\n    ${c.detail}`);
console.log("\nCrew actions:");
for (const a of report.crew_actions) console.log(`- ${a}`);
console.log("\nDecisions for Earth:");
for (const d of report.decisions_for_earth) console.log(`- ${d.decision}\n    why: ${d.why}`);
console.log(`\nMessage to Earth (${countWords(report.message_to_earth)} words):\n${report.message_to_earth}`);

const g = report.grounding;
console.log(`\nGROUNDING: ${g.numbers_checked} numbers checked, ${g.ungrounded.length} ungrounded${g.ungrounded.length ? ": " + g.ungrounded.join(", ") : ""}`);

const run: DemoRun = { as_of: asOf, report, trace, generated_at: new Date().toISOString(), model, is_sample: false };
DemoRunSchema.parse(run); // fail loudly rather than save a file the UI can't read
const outPath = join("data", "demo", `run-${asOf}.json`);
writeFileSync(outPath, JSON.stringify(run, null, 2) + "\n");
console.log(`\nSaved ${outPath}`);
