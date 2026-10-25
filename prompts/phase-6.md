Read CLAUDE.md first and follow it. This is Phase 6: QA sweep, then bug fixes. Runs LOCALLY.
Feature freeze is midnight: fix bugs and confusing UI only. No new features.

## Part A — QA sweep (find, don't fix)
1. Add Playwright as a dev dependency (if not present) and write scripts/qa.ts (npm script `qa`) that runs
   against the local dev server and:
   - loads the app in Replay mode at 1920×1080 and 1280×800;
   - clicks "Load recorded days through Jan 23", then clicks EVERY report day forward (Jan 12 → Jan 23)
     and then backward (Jan 23 → Jan 12), and also random jumps (e.g. Jan 23 → Jan 13 → Jan 18 → Jan 12);
   - runs the Jan 13 upload replay end to end;
   - expands every flag row, clicks every concern link, hovers each chart;
   - after every action records: console errors, uncaught exceptions, and whether the page body is
     blank (no main content rendered); saves a screenshot to qa-output/ (gitignored) for each day.
2. Run it and write docs/bugs.md: one row per bug with ID, steps to reproduce, the error message,
   severity (crash / wrong data / confusing / cosmetic), and the file most likely responsible.
3. Malek and his teammate will add manual findings to docs/bugs.md. Re-read it before Part B.

## Part B — Fix, in this order. Re-run `npm run qa` after each fix.

### Known bugs (Malek's decisions — implement exactly)
1. CRASH: navigating to an earlier report day turns the page black. Find the root cause from the QA
   console error and fix it (likely state or chart data derived from a later day). Also add a React
   error boundary around each major section so a future error shows "This section failed to render"
   with the message, never a blank page.
2. STALE WATER VOLUME: the "Water on hand" card must not present a pre-refill estimate as current.
   If a refill happened after the latest water_total reading (on or before as-of), show the value
   dimmed with a "STALE — predates the Jan 17 refill" label (use the real refill date), and say
   "No current volume estimate". Same rule the water scenarios already use — reuse that logic, don't
   duplicate it.
3. WATER SCENARIOS UNAVAILABLE MESSAGE: when null after a refill, the panel must name the dates:
   "The crew's last volume estimate (~360 L on Jan 13) predates the Jan 17 refill. No newer estimate
   was reported, so days-of-water can't be computed." Build the sentence from data, not hard-coded.
4. STATUS MARKERS (EMPTY/HALF/FULL and unreadable text): remove the diamonds above the plot. Instead,
   show a "Crew notes" row directly under each chart's x-axis: a small text pill on the matching day —
   EMPTY (red), HALF (amber), FULL (green), and for unreadable text a neutral pill with the crew's words
   (e.g. "less than ¾"). Pills are text with CSS styling, no custom SVG. Tooltip keeps the quote.
5. FROM-TOP WATER LINE: keep separate series, but label the "cm from top" series in the legend as
   "cm from top (higher = less water)" and add the same note under the chart.
6. CLIPPED "AS OF" LABEL: the as-of marker label must never clip at the chart edge (flip it to the left
   side of the line when near the right edge). Show the full date.
7. DUPLICATE EVENTS: when the engineering and commander reports for the same day describe the same event,
   show one flag with both quotes. Implement deterministically in src/lib/flags.ts: two
   CREW_REPORTED_EVENT flags on the same date are the same event if they share the same key noun from a
   small explicit list (e.g. "trailer tank", "static tank", "loft tank", "ATV", "propane", "diesel",
   "water heater"). Keep the higher severity, merge evidence. Add a test. Re-run `npm run build-demo`.
   The replay runs will be regenerated in Part C, so don't add any id-mapping workaround.

### Then everything else in docs/bugs.md
- Fix crashes and wrong-data bugs first, then confusing UI, then cosmetic.
- Skip anything that would be a new feature; list it under "Not fixed (feature)" in docs/bugs.md.

## Part C — A daily report for every report day (Malek's decision)
Do this only after Part B is finished, because Part B changes flag ids and the reports must reference
the final ones.
1. Extend scripts/daily-report.ts with `--all`: for every report date of crew-147 (Jan 12 → Jan 23),
   run the same pipeline as the API (analyzeCrew as of that date → agent → grounding) and write
   data/demo/run-<date>.json (is_sample: false). Run dates one at a time, not in parallel. Skip dates that
   already have a run file unless `--force`. If a run fails, log it and continue with the next date.
2. Run `npm run daily-report -- crew-147 --all --force` so every file, including Jan 13, is regenerated
   against the final flags. For each date print: flags cited, decisions count (must be ≤3), message word
   count, and grounding (numbers checked / ungrounded). If a date has ungrounded numbers or fails
   validation, re-run just that date once; if it still fails, keep the best result and list it in your
   summary — never hand-edit a report.
3. UI: load every data/demo/run-*.json (import.meta.glob, eager). The daily report section, status strip,
   and agent trace show the run for the selected as-of day. Scrubbing to a day shows its report
   instantly; only the Jan 13 upload in Replay plays the staged animation. Days with no run file keep
   the existing "No daily report" message.
4. Update data/demo/manifest.json only if its shape needs to list the run files; otherwise leave it.
5. Re-run `npm run qa`, and add a check that every report day now shows a daily report.

## Rules
- No custom SVG drawings (competition rule): Recharts, lucide-react, and CSS only.
- Don't change the API or the agent's behaviour. Replay run files change only through Part C's script.

## Done when
- `npm run qa` passes with zero console errors and zero blank pages across all days, both directions,
  both viewport sizes.
- docs/bugs.md shows each bug as fixed / not fixed (with reason).
- Every report day has a run file and shows a daily report; the per-date table from Part C is in your
  summary.
- Type check, build, tests, lint pass. README AI log and Current state updated.
- Stop and summarize with before/after notes for the 7 known bugs. Don't commit.
