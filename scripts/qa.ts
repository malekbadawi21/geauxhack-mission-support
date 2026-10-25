// scripts/qa.ts — automated QA sweep: clicks through the whole dashboard in a real browser and
// reports every console error, uncaught exception and blank page.
// Usage: npm run dev   (in another terminal), then   npm run qa
//
// How it fits: Phase 6's bug hunt. Playwright (a dev-only tool, never shipped in the app) starts a
// headless Chromium, opens the local dev server in Replay mode and does what a judge would do:
// load every recorded day, scrub forward, backward and at random, run the Jan 13 upload replay, open
// every flag, click every concern link and hover every chart. After each action it records what went
// wrong. Phase 7 adds layout checks on every day: no two x-axis date labels overlap, no chart without
// a number, the water panel's numbers change from Jan 14 to Jan 15, and Jan 18+ is in since-refill mode. Screenshots go to qa-output/ (gitignored). Exit code 1 if anything failed, so it can gate a
// "done" check. Talks only to localhost — no external service.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// chromium = the browser engine Playwright drives; Page = one browser tab.
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.QA_URL ?? "http://localhost:5173"; // Vite's default dev port
const OUT_DIR = "qa-output";

// The two screen sizes from the phase brief: a projector-size display and a laptop.
const VIEWPORTS = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1280x800", width: 1280, height: 800 },
];

// Random-looking but fixed jumps, so a failure can be reproduced exactly.
const JUMPS = ["Jan 23", "Jan 13", "Jan 18", "Jan 12", "Jan 21", "Jan 14", "Jan 22", "Jan 16"];

// One problem found: where (viewport + step) and what (kind + message).
type Problem = {
  viewport: string;
  step: string;
  kind: "console error" | "page error" | "blank page" | "section error" | "action failed" | "no daily report" | "layout" | "water panel";
  message: string;
};

const problems: Problem[] = [];
let actions = 0; // how many checks ran, for the summary line

/**
 * Collects console errors and uncaught exceptions from a tab into a list we drain after each action.
 * Why: page.on(...) fires asynchronously, so we buffer and attribute them to the step that just ran.
 */
function watch(page: Page): string[][] {
  const buffer: string[][] = []; // [kind, message] pairs
  page.on("console", (msg) => {
    if (msg.type() === "error") buffer.push(["console error", msg.text()]);
  });
  page.on("pageerror", (err) => buffer.push(["page error", err.message]));
  return buffer;
}

/**
 * Records everything that went wrong since the last check, plus whether the page is blank or a
 * section shows the error-boundary message.
 * @param step  Human label for the action just done, e.g. "forward → Jan 14".
 */
async function check(page: Page, buffer: string[][], viewport: string, step: string): Promise<void> {
  actions++;
  await page.waitForTimeout(120); // give React a moment to render and effects to run
  for (const [kind, message] of buffer.splice(0)) problems.push({ viewport, step, kind: kind as Problem["kind"], message }); // splice(0) empties the buffer
  // "Blank" = the main content is missing or nearly empty (a crashed React tree renders nothing).
  // page.evaluate runs code inside the browser. It is passed as a string because this script is
  // type-checked as Node code, where `document` and `window` don't exist.
  const textLength = (await page.evaluate(`document.querySelector("main.page")?.textContent?.length ?? 0`)) as number;
  if (textLength < 200) problems.push({ viewport, step, kind: "blank page", message: `main content has ${textLength} characters` });
  // The error boundaries (src/components/ErrorBoundary.tsx) render this text instead of crashing the page.
  const failed = await page.locator(".section-error").allTextContents();
  for (const message of failed) problems.push({ viewport, step, kind: "section error", message });
}

/**
 * Clicks the scrubber button for one day ("Jan 14").
 * If the button can't be clicked (the page crashed and the scrubber is gone), records the failure,
 * reloads with every day loaded, and returns false, so one crash doesn't stop the whole sweep.
 */
async function clickDay(page: Page, label: string, vp: string, step: string): Promise<boolean> {
  try {
    // exact: true so "Jan 1" would never match "Jan 12". A short timeout: the button is there or it isn't.
    await page.getByRole("radio", { name: label, exact: true }).click({ timeout: 3000 });
    return true;
  } catch (e) {
    problems.push({ viewport: vp, step, kind: "action failed", message: `could not click day ${label}: ${String(e).split("\n")[0]}` });
    await loadAllDays(page);
    return false;
  }
}

/** Opens the app fresh and loads every recorded day into the scrubber. */
async function loadAllDays(page: Page): Promise<void> {
  await page.goto(BASE_URL);
  await page.getByRole("button", { name: /Load recorded days through/ }).click();
}

/** The scrubber's day labels, oldest first. */
async function dayLabels(page: Page): Promise<string[]> {
  return page.locator(".scrubber__days button").allTextContents();
}

/**
 * Phase 7 layout checks for the day on screen: x-axis labels that overlap, and charts with no number.
 * The overlap test compares the on-screen boxes of every pair of tick labels within each chart.
 */
async function checkLayout(page: Page, vp: string, day: string): Promise<void> {
  actions++;
  // Runs in the browser (a string, see check()): for each chart, the indexes of overlapping label pairs.
  const overlaps = (await page.evaluate(`[...document.querySelectorAll(".chart")].map((c) => {
    const boxes = [...c.querySelectorAll(".recharts-xAxis-tick-labels text")].map((t) => t.getBoundingClientRect()).filter((r) => r.width > 0);
    const hits = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(i + "/" + j);
      }
    return { title: c.querySelector("h3")?.textContent, labels: boxes.length, hits };
  })`)) as { title: string; labels: number; hits: string[] }[];
  for (const o of overlaps) {
    if (o.labels === 0) problems.push({ viewport: vp, step: day, kind: "layout", message: `${o.title}: no x-axis labels found` });
    if (o.hits.length > 0) problems.push({ viewport: vp, step: day, kind: "layout", message: `${o.title}: x-axis labels overlap (${o.hits.join(", ")})` });
  }
  // UsageChart prints "no numeric readings" as its unit when it has nothing to plot: such a chart must not exist.
  const empty = await page.locator(".chart__unit", { hasText: "no numeric readings" }).count();
  if (empty > 0) problems.push({ viewport: vp, step: day, kind: "layout", message: `${empty} chart(s) with no numeric readings` });
}

/** Expands every collapsed flag row, then clicks every concern link in the daily report. */
async function exerciseFlagsAndConcerns(page: Page, buffer: string[][], vp: string, day: string): Promise<void> {
  const rows = page.locator('.flag__row[aria-expanded="false"]');
  // Each click removes one row from this locator's matches, so always click the first one left.
  for (let n = await rows.count(); n > 0; n--) await rows.first().click();
  await check(page, buffer, vp, `${day}: expand all flags`);
  const links = page.locator("button.flag-link");
  const count = await links.count();
  for (let i = 0; i < count; i++) await links.nth(i).click();
  if (count > 0) await check(page, buffer, vp, `${day}: click ${count} concern links`);
}

/** Moves the mouse across every chart at a few points, so each tooltip renders. */
async function hoverCharts(page: Page, buffer: string[][], vp: string, day: string): Promise<void> {
  const plots = page.locator(".chart__plot");
  const count = await plots.count();
  for (let i = 0; i < count; i++) {
    await plots.nth(i).scrollIntoViewIfNeeded();
    const box = await plots.nth(i).boundingBox();
    if (!box) continue;
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) await page.mouse.move(box.x + box.width * f, box.y + box.height / 2);
  }
  await page.mouse.move(0, 0);
  await check(page, buffer, vp, `${day}: hover ${count} charts`);
}

/** Saves a full-page screenshot to qa-output/. */
async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate("window.scrollTo(0, 0)"); // from the top, so the sticky header sits where it belongs
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: true });
}

/** The whole sweep at one screen size. */
async function sweep(vp: (typeof VIEWPORTS)[number]): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const buffer = watch(page);

  // 1. Load in Replay mode (the default).
  await page.goto(BASE_URL);
  await check(page, buffer, vp.name, "initial load");

  // 2. Load every recorded day, then step forward through each one.
  await page.getByRole("button", { name: /Load recorded days through/ }).click();
  await check(page, buffer, vp.name, "load recorded days");
  const days = await dayLabels(page);
  const waterText = new Map<string, string>(); // day → the water panel's text, for the checks after the loop
  for (const day of days) {
    if (!(await clickDay(page, day, vp.name, `forward → ${day}`))) continue;
    await check(page, buffer, vp.name, `forward → ${day}`);
    await checkLayout(page, vp.name, `forward → ${day}`);
    waterText.set(day, (await page.locator(".water").first().textContent()) ?? "");
    await shot(page, `${vp.name}-${day.replace(" ", "")}`);
    // Phase 6 Part C: every report day has a recorded run, so the daily report section must show it.
    if ((await page.locator("#report .transmission").count()) === 0) {
      problems.push({ viewport: vp.name, step: `forward → ${day}`, kind: "no daily report", message: `no daily report shown for ${day}` });
    }
    await exerciseFlagsAndConcerns(page, buffer, vp.name, day);
    await hoverCharts(page, buffer, vp.name, day);
  }

  // Phase 7: the projection moves day by day, so Jan 14 and Jan 15 must show different numbers, and
  // after the Jan 17 refill the panel must say so. .water__values holds only the numbers, not the notes.
  actions++;
  const values = async (day: string) => {
    await clickDay(page, day, vp.name, `water values ${day}`);
    return (await page.locator(".water .water__values").first().textContent()) ?? "";
  };
  const [v14, v15] = [await values("Jan 14"), await values("Jan 15")];
  if (!v14 || v14 === v15) problems.push({ viewport: vp.name, step: "Jan 14 vs Jan 15", kind: "water panel", message: "water panel values are the same on Jan 14 and Jan 15" });
  for (const day of days.filter((d) => ["Jan 18", "Jan 19", "Jan 21", "Jan 22", "Jan 23"].includes(d))) {
    if (!waterText.get(day)?.includes("Since Jan 17 refill")) {
      problems.push({ viewport: vp.name, step: day, kind: "water panel", message: `${day} is not in since-refill mode` });
    }
  }

  // 3. Backward through every day.
  for (const day of [...days].reverse()) {
    if (!(await clickDay(page, day, vp.name, `backward → ${day}`))) continue;
    await check(page, buffer, vp.name, `backward → ${day}`);
  }

  // 4. Random jumps.
  for (const day of JUMPS.filter((d) => days.includes(d))) {
    if (!(await clickDay(page, day, vp.name, `jump → ${day}`))) continue;
    await check(page, buffer, vp.name, `jump → ${day}`);
  }

  // 5. The Jan 13 upload replay, from a fresh page like the live demo.
  await page.goto(BASE_URL);
  await check(page, buffer, vp.name, "reload for upload");
  await page.getByRole("button", { name: "Upload report" }).click();
  await page.getByRole("button", { name: "Use demo files" }).click();
  await check(page, buffer, vp.name, "upload: started");
  // The replay takes ~15 s; "View daily report" appears when the last stage is done.
  await page.getByRole("button", { name: "View daily report" }).waitFor({ timeout: 60_000 });
  await check(page, buffer, vp.name, "upload: daily report ready");
  await shot(page, `${vp.name}-upload-jan13`);
  await exerciseFlagsAndConcerns(page, buffer, vp.name, "after upload");
  // Then scrub back to the preloaded day and forward again.
  if (await clickDay(page, "Jan 12", vp.name, "after upload → Jan 12")) await check(page, buffer, vp.name, "after upload → Jan 12");
  if (await clickDay(page, "Jan 13", vp.name, "after upload → Jan 13")) await check(page, buffer, vp.name, "after upload → Jan 13");

  await browser.close();
}

mkdirSync(OUT_DIR, { recursive: true });
try {
  await fetch(BASE_URL); // fails fast with a clear message if the dev server isn't running
} catch {
  console.error(`No dev server at ${BASE_URL}. Start it with: npm run dev`);
  process.exit(1);
}

for (const vp of VIEWPORTS) {
  console.log(`Sweeping at ${vp.name}…`);
  await sweep(vp);
}

writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(problems, null, 2) + "\n");
console.log(`\n${actions} checks, ${problems.length} problems. Screenshots and results.json in ${OUT_DIR}/`);
if (problems.length > 0) {
  // One line per distinct message, with how often and where it first appeared.
  const seen = new Map<string, { n: number; first: Problem }>();
  for (const p of problems) {
    const key = `${p.kind}: ${p.message.slice(0, 300)}`;
    const hit = seen.get(key);
    if (hit) hit.n++;
    else seen.set(key, { n: 1, first: p });
  }
  for (const [key, { n, first }] of seen) console.log(`- ${n}× ${key}\n    first at ${first.viewport} "${first.step}"`);
  process.exit(1);
}
console.log("QA passed: no console errors, no exceptions, no blank pages, a daily report on every day.");
