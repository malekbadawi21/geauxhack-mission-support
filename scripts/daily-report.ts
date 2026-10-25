// scripts/daily-report.ts — runs the agent from the command line and saves the run for demo replay.
// Usage: npm run daily-report -- crew-147 --as-of 2015-01-13     (one day)
//        npm run daily-report -- crew-147 --all [--force]          (every report day, Phase 6 Part C)
//
// How it fits: the same pipeline as api/daily-report.ts (saved extractions → analyzeCrew → agent →
// grounding check), without a server. It writes a real DemoRun to data/demo/run-<date>.json
// (is_sample: false). Those files are the fixed record the UI replays, so the demo never depends on
// Gemini being up. Node only (fs/path).
//
// --all runs every report date of the crew, one at a time (never in parallel: one Gemini quota, and a
// readable log). Dates that already have a run file are skipped unless --force. A date whose run fails,
// or whose report has numbers the grounding check couldn't trace, is re-run once and the better result
// is kept; a date that still fails is logged and the next date runs. Reports are never edited by hand.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { CREWS } from "../src/lib/constants.ts";
import { DemoRunSchema, countWords, type DemoRun } from "../src/lib/report-types.ts";
import { runDailyReport } from "../src/lib/agent/loop.ts";
import { loadSavedForReports } from "./save-extraction.ts";

// process.argv = [node, script, ...args]; we expect: <crew> (--as-of <YYYY-MM-DD> | --all) [--force]
const args = process.argv.slice(2);
const crewName = args[0];
const all = args.includes("--all");
const force = args.includes("--force");
const asOfArg = args.includes("--as-of") ? args[args.indexOf("--as-of") + 1] : undefined;
const crew = crewName ? CREWS[crewName] : undefined;
// Regex: exactly YYYY-MM-DD.
if (!crew || (!all && !(asOfArg && /^\d{4}-\d{2}-\d{2}$/.test(asOfArg)))) {
  console.error("Usage: npm run daily-report -- <crew, e.g. crew-147> (--as-of YYYY-MM-DD | --all) [--force]");
  process.exit(1);
}

process.loadEnvFile(".env"); // GEMINI_API_KEY, GEMINI_MODEL (Node built-in, see scripts/extract.ts)

const extractions = loadSavedForReports(join("data", "reports", crewName));

/** Where a date's run is saved. */
const runPath = (asOf: string) => join("data", "demo", `run-${asOf}.json`);

/** Runs the agent once for one date and returns a validated DemoRun (not saved yet). */
async function runOnce(asOf: string): Promise<DemoRun> {
  const analysis = analyzeCrew(extractions, asOf, crew!); // `!`: checked in the usage test above
  console.log(`Running agent for ${crew!.name} as of ${asOf} (${analysis.reportCount} reports, ${analysis.flags.length} flags)…`);
  const { report, trace, model } = await runDailyReport(analysis);
  const run: DemoRun = { as_of: asOf, report, trace, generated_at: new Date().toISOString(), model, is_sample: false };
  return DemoRunSchema.parse(run); // fail loudly rather than save a file the UI can't read
}

/**
 * Runs one date, and once more if the run threw or left ungrounded numbers. Keeps the run with the
 * fewest ungrounded numbers. Throws only if both attempts threw.
 * @returns  The kept run and how many attempts it took.
 */
async function runWithRetry(asOf: string): Promise<{ run: DemoRun; attempts: number }> {
  let best: DemoRun | null = null;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const run = await runOnce(asOf);
      if (!best || run.report.grounding.ungrounded.length < best.report.grounding.ungrounded.length) best = run;
      if (best.report.grounding.ungrounded.length === 0) return { run: best, attempts: attempt };
      console.log(`  ${run.report.grounding.ungrounded.length} ungrounded number(s): ${run.report.grounding.ungrounded.join(", ")}`);
    } catch (e) {
      lastError = e;
      console.error(`  attempt ${attempt} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (attempt === 1) console.log("  re-running this date once…");
  }
  if (best) return { run: best, attempts: 2 };
  throw lastError;
}

/** Prints a run in full: trace, report and grounding (the single-date output). */
function printRun(run: DemoRun): void {
  const { report, trace } = run;
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
}

/** The one-line facts the per-date table shows for a run. */
function summarize(run: DemoRun) {
  const r = run.report;
  return {
    overall: r.overall,
    flags_cited: new Set(r.concerns.flatMap((c) => c.flag_ids)).size, // distinct flag ids across concerns
    decisions: r.decisions_for_earth.length, // must be ≤ 3 (DailyReportSchema enforces it)
    words: countWords(r.message_to_earth),
    numbers_checked: r.grounding.numbers_checked,
    ungrounded: r.grounding.ungrounded.length,
  };
}

/** Saves a run to data/demo/run-<date>.json. */
function save(run: DemoRun): void {
  writeFileSync(runPath(run.as_of), JSON.stringify(run, null, 2) + "\n");
  console.log(`Saved ${runPath(run.as_of)}`);
}

if (!all) {
  const { run } = await runWithRetry(asOfArg!);
  printRun(run);
  save(run);
} else {
  // Every report date of the crew, oldest first ([...new Set(...)] drops the duplicate kinds per day).
  const dates = [...new Set(extractions.map((x) => x.date))].sort();
  const table: Record<string, unknown>[] = [];
  for (const asOf of dates) {
    if (!force && existsSync(runPath(asOf))) {
      console.log(`${asOf}: ${runPath(asOf)} exists, skipped (use --force to redo)`);
      table.push({ date: asOf, result: "skipped" });
      continue;
    }
    try {
      const { run, attempts } = await runWithRetry(asOf);
      save(run);
      const s = summarize(run);
      console.log(`${asOf}: ${s.overall}, ${s.flags_cited} flags cited, ${s.decisions} decisions, ${s.words} words, ${s.numbers_checked} numbers checked / ${s.ungrounded} ungrounded`);
      table.push({ date: asOf, result: s.ungrounded > 0 ? "saved (ungrounded)" : "saved", attempts, ...s });
    } catch (e) {
      // One bad date must not stop the others: log it and move on.
      console.error(`${asOf}: FAILED after 2 attempts — ${e instanceof Error ? e.message : String(e)}`);
      table.push({ date: asOf, result: "failed" });
    }
  }
  console.log("\nPER-DATE SUMMARY");
  console.table(table);
}
