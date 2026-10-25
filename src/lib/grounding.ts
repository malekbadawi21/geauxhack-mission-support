// grounding.ts — checks that every number in the agent's report came from data the agent was shown.
//
// How it fits: the agent (src/lib/agent/loop.ts) writes a DailyReport after calling tools that read
// the Analysis. An LLM can still type a number nobody gave it ("about 300 L", "6 days"). This file is
// the code-side guard: it pulls every number out of the report's text and looks for it in the tool
// outputs the agent actually received. Anything not found is listed in report.grounding.ungrounded,
// so the UI can show it instead of hiding it (CLAUDE.md: unverified data is flagged, never silently used).
//
// Dates need no special case: a date in the data ("2015-01-17") contributes 2015, 1 and 17, so
// "Jan 17" or "2015" in the report is grounded when that date appears in a tool output.
// Clock times are the exception: "19:00" is checked as one time, never as 19 and 0.
// Pure and browser-safe: no file, network or clock access.

import type { DailyReport } from "./report-types.ts";

export type Grounding = DailyReport["grounding"]; // { numbers_checked, ungrounded }

// Regex for a number as written: digits, optional thousands groups (",360"), optional decimals.
// \d+ = one or more digits; (?:,\d{3})* = zero or more ",ddd" groups; (?:\.\d+)? = optional ".dd".
// No leading minus: "−5%/day" and "dropped 5%" mean the same amount, so we compare sizes only.
const NUMBER_RE = /\d+(?:,\d{3})*(?:\.\d+)?/g;

/** Every number written in a string, as the text that was written ("12.12", "1,000"). */
function numbersIn(text: string): string[] {
  return text.match(NUMBER_RE) ?? []; // match with /g returns all matches, or null if none
}

// Regex for a clock time: "19:00", "8:00", "12:35pm", "10:30 AM". A time is ONE value, so "08:00" can't
// be grounded by an unrelated 8 and 0 in the data. (?<![\d:]) = not preceded by a digit or colon;
// (\d{1,2}):(\d{2}) = hours and minutes; (?!\d) = no third minute digit; then an optional am/pm that
// is not the start of a longer word ("12:35 amount" has no "am"). g = all matches, i = any case.
const TIME_RE = /(?<![\d:])(\d{1,2}):(\d{2})(?!\d)(?:\s?([ap]m)(?![a-z]))?/gi;

/**
 * Every clock time in a string, as 24-hour "HH:MM", so "12:35pm" and "12:35" compare equal.
 * Why it exists: the agent once wrote "by 08:00 tomorrow", a time no report gave.
 */
function timesIn(text: string): { written: string; time: string }[] {
  // matchAll gives each match with its groups: m[1] hours, m[2] minutes, m[3] "am"/"pm" or undefined.
  return [...text.matchAll(TIME_RE)].map((m) => {
    let hour = Number(m[1]);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && hour < 12) hour += 12; // 7pm -> 19
    if (ampm === "am" && hour === 12) hour = 0; // 12am -> 00
    return { written: m[0], time: `${String(hour).padStart(2, "0")}:${m[2]}` };
  });
}

/** Turns a written number into a value: "1,000" -> 1000. */
const toValue = (written: string) => Number(written.replaceAll(",", ""));

/**
 * Collects every number in a tool output: number fields, plus numbers written inside strings
 * (quotes like "Propane: 40%", dates like "2015-01-17", flag ids).
 * @param value  Any JSON-like value (object, array, string, number, ...).
 * @param out    The list being filled (absolute values).
 * Why it exists: the agent may quote a number from a report quote as easily as from a number field.
 */
function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number") {
    if (Number.isFinite(value)) out.push(Math.abs(value)); // sizes only, matching NUMBER_RE above
  } else if (typeof value === "string") {
    for (const n of numbersIn(value)) out.push(toValue(n));
  } else if (Array.isArray(value)) {
    for (const v of value) collectNumbers(v, out);
  } else if (value !== null && typeof value === "object") {
    // Object.values gives the field values; keys are names, not data, so they are skipped.
    for (const v of Object.values(value)) collectNumbers(v, out);
  }
}

/**
 * True if report number `a` matches tool number `b`: exactly, within rounding (|a−b| ≤ 0.5),
 * or within 1% when the tool number is above 50 (e.g. "about 1,000 L" for 1,003).
 * Why the rules: the agent should round 4.243 days to "4.2" or "4"; it should not invent a new figure.
 */
export function matchesWithinRounding(a: number, b: number): boolean {
  const diff = Math.abs(a - b);
  return diff <= 0.5 || (b > 50 && diff <= 0.01 * b);
}

/** Every human-readable text field of a report (flag_ids are ids, checked separately by the agent). */
function reportTexts(report: Omit<DailyReport, "grounding">): string[] {
  return [
    report.status_line,
    // flatMap: each concern gives two strings; flatMap joins them into one flat list.
    ...report.concerns.flatMap((c) => [c.title, c.detail]),
    ...report.crew_actions,
    ...report.decisions_for_earth.flatMap((d) => [d.decision, d.why]),
    report.message_to_earth,
  ];
}

/**
 * Checks every number in a report against the numbers the agent received from its tools.
 * @param report       The agent's report (its grounding field, if any, is ignored).
 * @param toolOutputs  Every tool result the agent was given during its run, in any order.
 * @returns            How many numbers were checked, and the written form of each one not found
 *                     (each distinct number listed once).
 */
export function checkGrounding(report: Omit<DailyReport, "grounding">, toolOutputs: unknown[]): Grounding {
  const known: number[] = [];
  collectNumbers(toolOutputs, known);
  // Every time anywhere in the tool outputs (JSON.stringify reaches every nested string at once).
  const knownTimes = new Set(timesIn(JSON.stringify(toolOutputs)).map((t) => t.time));

  const texts = reportTexts(report);
  const times = texts.flatMap(timesIn);
  // Times are checked whole, so they are blanked out before numbers are read from the text.
  const written = texts.flatMap((t) => numbersIn(t.replace(TIME_RE, " ")));
  const ungrounded = new Set<string>(); // a Set keeps each distinct string once, in first-seen order
  for (const t of times) if (!knownTimes.has(t.time)) ungrounded.add(t.written);
  for (const w of written) {
    const v = toValue(w);
    if (!known.some((k) => matchesWithinRounding(v, k))) ungrounded.add(w);
  }
  return { numbers_checked: times.length + written.length, ungrounded: [...ungrounded] };
}
