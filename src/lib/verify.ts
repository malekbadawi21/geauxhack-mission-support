// verify.ts — checks that every quote Gemini returned actually appears in the original report.
//
// Anti-hallucination design: an LLM can produce a plausible reading that isn't in the report.
// Because we make Gemini attach a `source_quote` to every reading and event, we can catch that with
// a plain substring check — no AI involved. Anything that fails is marked `verified: false` so the
// UI and later phases can flag it instead of silently using a number that might be invented.
//
// Pure function, no network or file access: the same inputs always give the same output.

// `import type` brings in TypeScript types only; nothing is imported at runtime.
import type { Extraction, Reading, ReportEvent } from "./schema.ts";

// `A & { verified: boolean }` is an intersection type: "everything in A, plus a verified field".
export type VerifiedReading = Reading & { verified: boolean };
export type VerifiedEvent = ReportEvent & { verified: boolean };
// Omit<T, keys> copies type T without the listed keys; we then add them back with verified versions.
export type VerifiedExtraction = Omit<Extraction, "readings" | "events"> & {
  readings: VerifiedReading[];
  events: VerifiedEvent[];
};

/**
 * Turns every run of spaces, tabs, and newlines into a single space and trims the ends.
 * @param s  Any string.
 * @returns  The same text with whitespace normalized.
 * Why it exists: the report has hard line breaks and trailing spaces mid-sentence, and Gemini may
 * join a wrapped line with a space. Those differences are harmless; any other difference is not.
 */
function collapseWhitespace(s: string): string {
  // Regex /\s+/g: \s = any whitespace char (space, tab, newline), + = one or more in a row,
  // g = replace every match, not just the first.
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Marks each reading and event verified only if its source_quote appears verbatim in the report.
 * @param text        The original report text that was sent to Gemini.
 * @param extraction  Gemini's validated output from extractReport().
 * @returns           The same extraction, with `verified: boolean` added to every reading and event.
 * Why it exists: it is the code-side guarantee that no number reaches forecasting unless the crew
 * actually wrote it. The match is case-sensitive and exact apart from whitespace.
 */
export function verifyQuotes(text: string, extraction: Extraction): VerifiedExtraction {
  const haystack = collapseWhitespace(text); // normalize the report once, not per quote
  // An empty quote would "match" anything, so it never counts as verified.
  const isVerbatim = (quote: string) => {
    const needle = collapseWhitespace(quote);
    return needle.length > 0 && haystack.includes(needle);
  };

  return {
    ...extraction, // spread: copy report_date, crew, author, questions unchanged
    // .map builds a new array; { ...r, verified } copies each item and adds the flag
    // (we never mutate Gemini's original objects).
    readings: extraction.readings.map((r) => ({ ...r, verified: isVerbatim(r.source_quote) })),
    events: extraction.events.map((e) => ({ ...e, verified: isVerbatim(e.source_quote) })),
  };
}
