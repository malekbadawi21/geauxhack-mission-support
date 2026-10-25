// scripts/analyze.ts — prints what our tool would have told the crew on a given day.
// Usage: npm run analyze -- crew-147 --as-of 2015-01-13
//
// How it fits: it reads the SAVED extractions from disk (no Gemini calls — this is replay mode),
// passes them to analyzeCrew() (the same function the UI will call), prints the result as tables,
// and writes the full Analysis JSON to data/extractions/<crew>-analysis-<date>.json.
// All the logic lives in src/lib/; this file only loads files and formats output — except the
// "retrospective check", which deliberately looks at LATER reports and so must never be in the app.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { normalizeDate } from "../src/lib/dates.ts";
import { CREWS } from "../src/lib/constants.ts";
import { loadSavedForReports, reportKind, EXTRACTIONS_DIR } from "./save-extraction.ts";

const args = process.argv.slice(2);
const crew = args.find((a) => !a.startsWith("--"));
// The value after "--as-of" (indexOf returns -1 if the flag is absent, so [0] would be crew — guarded below).
const asOfIdx = args.indexOf("--as-of");
const asOf = asOfIdx >= 0 ? normalizeDate(args[asOfIdx + 1] ?? null) : null;
if (!crew || !asOf) {
  console.error("Usage: npm run analyze -- <crew> --as-of YYYY-MM-DD");
  process.exit(1);
}
const crewConfig = CREWS[crew];
if (!crewConfig) {
  console.error(`Unknown crew "${crew}". Known: ${Object.keys(CREWS).join(", ")} (add it to CREWS in src/lib/constants.ts)`);
  process.exit(1);
}

// Every report kind: analyzeCrew merges a day's engineering and commander reports.
const extractions = loadSavedForReports(join("data", "reports", crew));
const a = analyzeCrew(extractions, asOf, crewConfig);

/** Rounds for display only (the JSON keeps full precision); null prints as "—". */
const n = (x: number | null, digits = 2) => (x === null ? "—" : String(Math.round(x * 10 ** digits) / 10 ** digits));
/** Collapses a quote's line breaks so it prints on one line. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

console.log(`\n=== ${a.crew.name} as of ${a.asOf}: ${a.reportCount} reports, latest ${a.latestReportDate ?? "(none)"} (${a.latestReportKinds.join(" + ")}) ===`);

console.log("\nREADINGS (latest day, all reports merged; engineering first)");
console.table(
  a.latestReadings.map((r) => ({
    report: r.report_kind,
    resource: r.resource,
    raw_text: r.raw_text,
    value: r.value,
    unit: r.unit,
    status: r.status ?? "",
    approx: r.approximate ? "~" : "",
    measured_from: r.measured_from,
    verified: r.verified ? "yes" : "NO",
    reason: r.reason ?? "",
  })),
);

console.log("\nSERIES (value per report day; change = amount change, negative = used up; R = refill; ~ = approximate; [c] = from commander report)");
// One row per date, one column per resource: "75 percent (0)" = value 75, change 0.
const dates = a.series[0]?.points.map((p) => p.date) ?? [];
console.table(
  dates.map((date, i) => {
    const row: Record<string, string> = { date }; // Record<string, string> = object with any string keys
    for (const s of a.series) {
      const p = s.points[i];
      const tag = `${p.refill ? " R" : ""}${p.report_kind && p.report_kind !== "engineering" ? ` [${p.report_kind[0]}]` : ""}`;
      if (p.raw_text === null) row[s.resource] = "";
      else if (p.status !== null) row[s.resource] = `${p.status}${tag}`;
      else if (p.value === null) row[s.resource] = `null ("${p.raw_text}")${tag}`;
      else row[s.resource] = `${p.approximate ? "~" : ""}${n(p.value)} ${p.unit}${p.measured_from ? ` from ${p.measured_from}` : ""} (${n(p.change_from_previous)})${tag}`;
    }
    return row;
  }),
);

console.log("\nFORECASTS");
console.table(
  a.forecasts.map((f) => ({
    resource: f.resource,
    latest: f.latest ? `${f.latest.value} ${f.latest.unit} (${f.latest.date})` : "—",
    rate_per_day: n(f.rate_per_day),
    days_to_empty: n(f.days_to_empty, 1),
    points_used: f.points_used,
    reason: f.reason ?? "",
  })),
);

console.log("\nFLAGS (most severe first)");
for (const f of a.flags) {
  console.log(`[${f.severity.toUpperCase()}] ${f.id}: ${f.message}`);
  for (const e of f.evidence) console.log(`    quote (${e.report_kind}): "${oneLine(e.quote)}"`);
}

console.log(`\nWATER STATUS (${a.water.mode})`);
const w = a.water;
if (w.mode === "none") {
  console.log(`  ${w.reason}`);
} else if (w.mode === "since_refill") {
  const e = w.last_estimate_before_refill;
  console.log(`  refilled ${w.refill.date} (${w.refill.resource}, ${w.refill.days_since_refill} days ago); last estimate ${e.approximate ? "~" : ""}${n(e.volume_l)} L on ${e.reading_date} is stale`);
  console.log(`  measured trend: ${w.measured_trend?.description ?? w.measured_trend_reason}`);
  for (const d of w.estimated_draw_since_refill) console.log(`  - ${d.label}: ~${n(d.used_l, 1)} L USED since the refill (estimate, not remaining)`);
  console.log(`  missing: ${w.missing}`);
} else {
  const e = w.estimate;
  console.log(`  ${e.approximate ? "~" : ""}${n(e.volume_l)} L on ${e.reading_date} ("${oneLine(e.source_quote)}"), ${e.days_since_estimate} days old, crew of ${w.crew_size} (${w.crew_size_source})`);
  for (const s of w.scenarios) {
    console.log(`  - ${s.label}: ${s.rate_l_per_person_day} L/person/day → ${n(s.remaining_l, 1)} L left, ${n(s.days_left, 1)} days → runs out ${s.runs_out_on} [${s.status}]`);
  }
  const b = w.budget_to_mission_end;
  console.log(`  budget to mission end (${w.mission_end}, ${w.days_until_mission_end} days): ${b ? `${n(b.if_typical_so_far)}–${n(b.if_minimal_so_far)} L/person/day` : "—"}`);
}
for (const note of w.notes) console.log(`  note: ${note}`);

// Retrospective check (CLI only, deliberately looks ahead): did the crew later say they were running
// out of water, and when? Compared with the FMARS-rate date, it shows how realistic that projection was.
console.log("\nRETROSPECTIVE CHECK (uses reports AFTER the as-of date — never shown in the app)");
const fmars = w.mode === "projected" ? w.scenarios.find((s) => s.id === "fmars_average") : undefined;
if (w.mode !== "projected" || !fmars) {
  console.log("  n/a: no projection for this date");
} else {
  const later = extractions
    .filter((x) => x.date > w.estimate.reading_date && reportKind(x.source_file) === "commander")
    .flatMap((x) => [...x.readings, ...x.events, ...x.questions_to_mission_support].map((i) => ({ date: x.date, quote: oneLine(i.source_quote) })))
    .filter((i) => /run out/i.test(i.quote)); // Regex: the words "run out", any case
  // The same sentence often backs several items; keep each (date, quote) once.
  const unique = [...new Map(later.map((i) => [`${i.date}|${i.quote}`, i])).values()];
  if (unique.length === 0) console.log(`  FMARS rate said water runs out ${fmars.runs_out_on}; no later commander report mentions running out`);
  for (const i of unique) console.log(`  FMARS rate said water runs out ${fmars.runs_out_on} | ${i.date} commander: "${i.quote}"`);
}

console.log("\nQUESTIONS TO MISSION SUPPORT");
for (const q of a.questions) console.log(`- ${q.verified ? "[verified]" : "[UNVERIFIED]"} (${q.report_kind}) ${q.text}`);

const outPath = join(EXTRACTIONS_DIR, `${crew}-analysis-${a.asOf}.json`);
writeFileSync(outPath, JSON.stringify(a, null, 2) + "\n");
console.log(`\nSaved ${outPath}`);
