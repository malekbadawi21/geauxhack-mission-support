Read CLAUDE.md first and follow it. This is Phase 2: batch extraction + deterministic analysis pipeline. CLI only — no UI, no agent loop yet.

## Goal
Turn all Crew 147 engineering reports into a time series, then compute forecasts and flags in plain
TypeScript. Running one command "as of" a date should print what our tool would have told the crew that day.

## End goal this phase must support (read this)
The final app lets a user upload a new report and instantly see: usage charts per resource over time,
forecasts (how long things last), flags, and a daily report. So:
- The analysis core must be pure functions that take extractions IN MEMORY and return one typed
  `Analysis` object. The CLI and the future UI both call the same function. An uploaded report is just
  one more extraction appended to the list.
- Everything in `src/lib/` except `extract.ts` must run in the browser: no `fs`, `path`, or
  `process` imports. File reading lives only in `scripts/`. `extract.ts` is server-only (it holds the
  Gemini key) and must never be imported by UI code — say so in its header comment.

## Rules for this phase
- Never guess. If a value can't be normalized or forecast with certainty, it stays null with a
  human-readable `reason` (e.g. "static tank reading doesn't say measured from top or bottom").
- Every threshold we choose ourselves lives in one constants file, commented as "our choice", never
  presented as NASA data. Real baselines get a source URL in a comment.
- Comment extensively per CLAUDE.md.

## Tasks
1. Schema + extraction fixes
   - Add `source_quote` to each question_to_mission_support (make it an object: { text, source_quote })
     and verify it in verify.ts like everything else.
   - In extract.ts, retry on 503/429: up to 3 attempts with waits of 2s, 4s, 8s. Log each retry.
   - Add `src/lib/dates.ts`: normalize report_date strings like "01/13/2015" to "2015-01-13".
     If the date is missing or unparseable, fall back to the date in the filename and record that it did.

2. Batch extraction (`scripts/extract-all.ts`, npm script `extract-all`)
   - Usage: `npm run extract-all -- data/reports/crew-147` (add `--force` to redo existing ones).
   - Extract every .txt in the folder, skipping any whose JSON already exists in data/extractions/
     (Gemini output varies between runs; the saved JSON is our fixed record for the demo).
   - Then print and save `data/extractions/crew-147-survey.md`: one row per report, one column per
     resource, showing raw_text exactly as extracted, plus a column of unverified-quote counts.

3. Format survey → normalization rules
   - Read the survey before writing normalize.ts. In the file's header comment, list every format you
     found per resource and the rule you chose for it.
   - `src/lib/normalize.ts`: convert each reading to one standard unit per resource:
     - diesel, propane, gasoline → percent of tank (fractions like "¾" → 75; explicit words only if
       the mapping is exact, e.g. "full" → 100, "half" → 50; anything vaguer → null + reason)
     - water readings → keep the unit the crew used (cm, in, gal, L). Convert L↔gal and in↔cm only with
       exact constants. Keep measured_from. Do NOT convert tank levels to volume unless the report
       itself gives the capacity.
   - Output: `NormalizedReading { date, resource, value, unit, measured_from, raw_text, source_quote, verified, reason }`

4. Forecasting (`src/lib/forecast.ts`)
   - Input: the normalized series for one resource up to an "as of" date.
   - Treat an increase as a refill only if it exceeds REFILL_THRESHOLD (in constants.ts, our choice:
     5 percentage points for percent units; for other units, any increase larger than 5% of the
     previous value). Smaller increases are measurement noise and are kept in the series.
     Only use readings after the most recent refill.
   - Rate = average change per day across the remaining readings (need at least 2 readings).
   - Days-to-empty only when "empty" is well defined for that unit:
     - percent → empty at 0%
     - level measured from the bottom → empty at 0
     - level measured from the top or unknown → no days-to-empty, return the trend only + reason
   - Output: { resource, latest, rate_per_day, days_to_empty | null, points_used, reason | null }

5. Flags (`src/lib/flags.ts`, thresholds in `src/lib/constants.ts`)
   - LOW_LEVEL: latest percent below a threshold (our choice, e.g. 25%)
   - RUNS_OUT_BEFORE_MISSION_END: days_to_empty < days left in the rotation (mission end date in constants:
     the date of the last Crew 147 report, with a comment saying so)
   - USAGE_SPIKE: a day's drop is more than 2× the median daily drop for that resource
   - MISSING_READING: a resource reported on earlier days is absent today
   - UNVERIFIED_QUOTE: any reading/event/question whose quote didn't verify
   - CREW_REPORTED_EVENT: surface every extracted event (leak, resupply issue, failure) as context
   - Each flag: { type, severity: "critical" | "warning" | "info", resource | null, message, evidence: source_quote[] }
   - Alerts come from these rules, never from Gemini's event labels.

6. Baselines (`src/lib/baselines.ts`)
   - Only these, each with its source URL in a comment:
     - NASA-STD-3001 ECLSS technical brief: minimum 2.5 L potable water per crewmember per day
       (https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-002-eclss.pdf)
     - FMARS four-month analog study: average 12.12 L of water per crewmember per sol
       (https://core.ac.uk/works/63185982)
   - Use them only if water use can actually be computed in liters from the reports. If it can't,
     export them unused and say so in Current state.

7. Analysis core (`src/lib/analyze.ts`) — the contract the UI will use
   - Export `analyzeCrew(extractions: Extraction[], asOf: string): Analysis` (pure, browser-safe).
   - Only uses extractions dated on or before `asOf` (no looking ahead).
   - `Analysis` contains:
     - `asOf`, `reportCount`
     - `latestReadings`: NormalizedReading[] for the as-of day
     - `series`: per resource, one point per report day:
       { date, value | null, unit, change_from_previous | null, refill: boolean } — this feeds the charts
     - `forecasts`: Forecast[]
     - `flags`: Flag[] sorted by severity
     - `events` and `questions` from the as-of day, with verification status
   - Export the `Analysis` type from schema.ts or analyze.ts so the UI can import it.

8. Analysis CLI (`scripts/analyze.ts`, npm script `analyze`)
   - Usage: `npm run analyze -- crew-147 --as-of 2015-01-13`
   - Reads saved extractions from disk (no Gemini calls), calls `analyzeCrew`, and prints:
     readings table → series table → forecasts table → flags sorted by severity, each with its
     evidence quote. Also writes the Analysis JSON to `data/extractions/crew-147-analysis-<date>.json`.

9. Tests
   - Add vitest (dev dependency). Write small tests for normalize (¾ → 75, "40%" → 40, unknown → null),
     forecast (refill above threshold resets the window, a +2% bump does not, <2 points → null,
     top-measured level → no days_to_empty), and analyzeCrew (asOf excludes later reports).

## Done when
- `npm run extract-all -- data/reports/crew-147` completes and the survey file exists.
- `npm run analyze -- crew-147 --as-of 2015-01-13` prints readings, forecasts and flags, and the
  trailer-tank rupture appears as a flag with its quote.
- No file in `src/lib/` other than `extract.ts` imports fs, path, or process (grep to confirm).
- Type check, build and tests pass.
- README AI log updated; Current state in CLAUDE.md rewritten (include what the survey revealed and
  any resource we could not forecast and why).
- Then stop and summarize. Do not start the agent loop or UI. Don't commit.
