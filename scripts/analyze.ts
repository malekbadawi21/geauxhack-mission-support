// scripts/analyze.ts — prints what our tool would have told the crew on a given day.
// Usage: npm run analyze -- crew-147 --as-of 2015-01-13
//
// How it fits: it reads the SAVED extractions from disk (no Gemini calls — this is replay mode),
// passes them to analyzeCrew() (the same function the UI will call), prints the result as tables,
// and writes the full Analysis JSON to data/extractions/<crew>-analysis-<date>.json.
// All the logic lives in src/lib/; this file only loads files and formats output.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeCrew } from "../src/lib/analyze.ts";
import { normalizeDate } from "../src/lib/dates.ts";
import { loadSavedForReports, EXTRACTIONS_DIR } from "./save-extraction.ts";

const args = process.argv.slice(2);
const crew = args.find((a) => !a.startsWith("--"));
// The value after "--as-of" (indexOf returns -1 if the flag is absent, so [0] would be crew — guarded below).
const asOfIdx = args.indexOf("--as-of");
const asOf = asOfIdx >= 0 ? normalizeDate(args[asOfIdx + 1] ?? null) : null;
if (!crew || !asOf) {
  console.error("Usage: npm run analyze -- <crew> --as-of YYYY-MM-DD");
  process.exit(1);
}

const extractions = loadSavedForReports(join("data", "reports", crew));
const a = analyzeCrew(extractions, asOf);

/** Rounds for display only (the JSON keeps full precision); null prints as "—". */
const n = (x: number | null, digits = 2) => (x === null ? "—" : String(Math.round(x * 10 ** digits) / 10 ** digits));

console.log(`\n=== ${crew} as of ${a.asOf}: ${a.reportCount} reports, latest ${a.latestReportDate ?? "(none)"} ===`);

console.log("\nREADINGS (latest report)");
console.table(
  a.latestReadings.map((r) => ({
    resource: r.resource,
    raw_text: r.raw_text,
    value: r.value,
    unit: r.unit,
    measured_from: r.measured_from,
    verified: r.verified ? "yes" : "NO",
    reason: r.reason ?? "",
  })),
);

console.log("\nSERIES (value per report day; change = amount change, negative = used up; R = refill)");
// One row per date, one column per resource: "75 (0)" = value 75, change 0.
const dates = a.series[0]?.points.map((p) => p.date) ?? [];
console.table(
  dates.map((date, i) => {
    const row: Record<string, string> = { date }; // Record<string, string> = object with any string keys
    for (const s of a.series) {
      const p = s.points[i];
      if (p.raw_text === null) row[s.resource] = "";
      else if (p.value === null) row[s.resource] = `null ("${p.raw_text}")`;
      else row[s.resource] = `${n(p.value)} ${p.unit}${p.measured_from ? ` from ${p.measured_from}` : ""} (${n(p.change_from_previous)})${p.refill ? " R" : ""}`;
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
  console.log(`[${f.severity.toUpperCase()}] ${f.type}${f.resource ? ` (${f.resource})` : ""}: ${f.message}`);
  for (const q of f.evidence) console.log(`    quote: "${q.replace(/\s+/g, " ").trim()}"`);
}

console.log("\nQUESTIONS TO MISSION SUPPORT");
for (const q of a.questions) console.log(`- ${q.verified ? "[verified]" : "[UNVERIFIED]"} ${q.text}`);

const outPath = join(EXTRACTIONS_DIR, `${crew}-analysis-${a.asOf}.json`);
writeFileSync(outPath, JSON.stringify(a, null, 2) + "\n");
console.log(`\nSaved ${outPath}`);
