// dates.ts — turns the date strings crews write into one standard form (YYYY-MM-DD) and does
// day arithmetic on them.
//
// How it fits: Gemini copies report_date exactly as written ("01/13/2015"). Normalizing it is our
// code's job (CLAUDE.md: the LLM reads, deterministic code does the rest). Every later step —
// sorting reports, "as of" filtering, rates per day — works on YYYY-MM-DD strings, which sort
// correctly as plain text. Browser-safe: no Node-only imports.

/**
 * Builds a YYYY-MM-DD string if the year/month/day form a real calendar date.
 * @returns  The ISO date string, or null for impossible dates like 02/30/2015.
 * Why it exists: a regex can match "13/45/2015"; only a calendar check catches that.
 */
function isoIfReal(year: number, month: number, day: number): string | null {
  // Date.UTC uses 0-based months. If the day overflows (Feb 30), JS silently rolls it into the next
  // month, so we compare the parts back to detect that. UTC avoids time-zone shifts entirely.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  // padStart(2, "0") turns 1 into "01".
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Normalizes a date as written in a report to YYYY-MM-DD.
 * @param raw  e.g. "01/13/2015", "1/13/2015", "2015-01-13" (null if the report had none).
 * @returns    "2015-01-13", or null if the format isn't one we recognize.
 * Why it exists: US reports use M/D/YYYY; we only accept formats that are unambiguous for MDRS
 * (US month-first, or ISO). Anything else returns null rather than guessing the order.
 */
export function normalizeDate(raw: string | null): string | null {
  if (raw === null) return null;
  const s = raw.trim();
  // Regex: ^ start, (\d{1,2}) one or two digits = month, \/ a literal slash, ... (\d{4}) year, $ end.
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return isoIfReal(Number(us[3]), Number(us[1]), Number(us[2]));
  // ISO form: 4-digit year, dash, 2-digit month, dash, 2-digit day.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoIfReal(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

/**
 * Finds the YYYY-MM-DD date in a report filename like "2015-01-13-engineering.txt".
 * @returns  The date, or null if the filename has none.
 */
export function dateFromFilename(filename: string): string | null {
  // Regex: the first run of 4 digits - 2 digits - 2 digits anywhere in the name.
  const m = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? isoIfReal(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/**
 * Decides which date a report belongs to: the date written in it, else the one in its filename.
 * @param reportDate  report_date as Gemini copied it (may be null).
 * @param filename    The report's filename.
 * @returns           { date, fromFilename } — fromFilename records that we fell back.
 * @throws            If neither source gives a usable date (we refuse to invent one).
 */
export function resolveReportDate(
  reportDate: string | null,
  filename: string,
): { date: string; fromFilename: boolean } {
  const fromReport = normalizeDate(reportDate);
  if (fromReport) return { date: fromReport, fromFilename: false };
  const fromFile = dateFromFilename(filename);
  if (fromFile) return { date: fromFile, fromFilename: true };
  throw new Error(`No usable date in report ("${reportDate}") or filename ("${filename}")`);
}

/**
 * Whole days from date `a` to date `b` (both YYYY-MM-DD). Positive if b is later.
 * Why it exists: rates are "per day", and reports are not always on consecutive days (Jan 19 → 21).
 */
export function daysBetween(a: string, b: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // Appending "T00:00:00Z" parses the date as midnight UTC, so daylight-saving never adds an hour.
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY);
}

/**
 * The date `n` whole days after `date` (YYYY-MM-DD in, YYYY-MM-DD out).
 * Why it exists: water.ts turns "4.2 days of water left" into a calendar date.
 */
export function addDays(date: string, n: number): string {
  // Same UTC-midnight trick as daysBetween; toISOString() gives "2015-01-17T00:00:00.000Z",
  // and slice(0, 10) keeps just the "2015-01-17" part.
  const ms = Date.parse(`${date}T00:00:00Z`) + n * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);
}
