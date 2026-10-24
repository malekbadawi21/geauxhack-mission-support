// scripts/fetch-reports.ts — downloads MDRS report pages once and saves them as plain text in data/.
// Usage: npm run fetch-reports
//
// How it fits: this is a one-time, dev-only data-collection tool. It is never imported by the app, so
// the app itself makes no web requests (CLAUDE.md: all data is bundled in data/). After it runs, the
// saved .txt files are the source of truth that extract-all.ts sends to Gemini.
//
// Rules: (1) HTML → plain text with NO rewording (see html-to-text.ts). (2) Files that already exist
// are skipped, so hand-saved reports are never overwritten. (3) Every saved file gets a line in
// data/SOURCES.md with its URL.

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { htmlToText } from "./html-to-text.ts";

const OUT_DIR = join("data", "reports", "crew-147");
const SOURCES = join("data", "SOURCES.md");
const BASE = "https://mdrs2013.marssociety.org/home/crew-147/";

// Which page goes to which file. `note` is added to the SOURCES.md line.
const REPORTS: { url: string; file: string; note?: string }[] = [
  { url: BASE + "112-commandersreport", file: "2015-01-12-commander.txt" },
  { url: BASE + "113-commandersreport", file: "2015-01-13-commander.txt" },
  { url: BASE + "114-commandersreport", file: "2015-01-14-commander.txt" },
  { url: BASE + "115-commandersreport", file: "2015-01-15-commander.txt" },
  { url: BASE + "116-commandersreport", file: "2015-01-16-commander.txt" },
  { url: BASE + "117-commandersreport", file: "2015-01-17-commander.txt" },
  { url: BASE + "118-commandersreport", file: "2015-01-18-commander.txt" },
  { url: BASE + "119-commandersreport", file: "2015-01-19-commander.txt" },
  { url: BASE + "122-commandersreport", file: "2015-01-22-commander.txt" },
  { url: BASE + "123-commandersreport", file: "2015-01-23-commander.txt" },
  { url: BASE + "final-mission-report", file: "final-mission-report.txt", note: "reference only, not extracted" },
];

// --- Main: fetch each page that isn't saved yet ----------------------------------------------
const sources = readFileSync(SOURCES, "utf8");
let failures = 0;
for (const { url, file, note } of REPORTS) {
  const outPath = join(OUT_DIR, file);
  if (existsSync(outPath)) {
    console.log(`skip  ${file} (exists)`);
    continue;
  }
  // fetch() is built into Node 18+; `await` waits for the response, then for its body text.
  const res = await fetch(url);
  if (!res.ok) {
    failures++;
    console.error(`FAILED ${file}: HTTP ${res.status} from ${url}`);
    continue;
  }
  const text = htmlToText(await res.text());
  writeFileSync(outPath, text);
  console.log(`saved ${file} (${text.split("\n").length - 1} lines)`);
  const line = `- reports/crew-147/${file} — ${url}${note ? ` (${note})` : ""}\n`;
  if (!sources.includes(url)) appendFileSync(SOURCES, line); // don't list a URL twice
}
if (failures > 0) process.exit(1);
