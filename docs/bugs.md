# Bugs — Phase 6 QA sweep

Found by `npm run qa` (scripts/qa.ts: Replay mode, 1920×1080 and 1280×800, every day forward, backward
and in random jumps, the Jan 13 upload replay, every flag expanded, every concern link clicked, every
chart hovered) plus a look at the screenshots in `qa-output/`. K = known bug from prompts/phase-6.md,
Q = new bug found by the sweep. Fix order: crash → wrong data → confusing → cosmetic.

First sweep: 110 checks, 40 problems (14 uncaught exceptions, 14 blank pages, 12 actions that failed
because the page had gone blank). Final sweep (after Part B and Part C): 144 checks, 0 problems — no
console errors, no exceptions, no blank pages, a daily report on every report day, both directions,
both viewports.

| ID | Severity | Steps to reproduce | Error / symptom | Likely file | Status |
|----|----------|--------------------|-----------------|-------------|--------|
| K1 | crash | Load recorded days → click Jan 23 → click Jan 22 (any earlier day after a later one) | `TypeError: Cannot read properties of undefined (reading 'date')` at `UsageChart.tsx` `valueDot` (`rows[props.index].date`); React unmounts the whole tree, page goes black | src/components/UsageChart.tsx | fixed — dot renderer reads the row Recharts passes (`payload`), not `rows[index]`; every section wrapped in an ErrorBoundary |
| K2 | wrong data | Load recorded days → Jan 17 (or later) | "Water on hand" card shows "~360 L" (Jan 13 estimate) as if current, though the tanks were refilled Jan 17 | src/components/ResourceCards.tsx | fixed — card uses water.ts `latestWaterVolume()` (same rule as the scenarios): value dimmed, "STALE — predates the Jan 17 refill", "No current volume estimate" |
| K3 | confusing | Jan 17 or later → Water scenarios panel | Says only "Last volume estimate predates a refill." — no dates, no volume | src/components/WaterScenarios.tsx, src/lib/water.ts | fixed — sentence built from `latestWaterVolume()`: volume, its date and the refill date |
| K4 | confusing | Any day ≥ Jan 13 → Diesel / Static / Loft / Trailer charts | Diamonds above the plot; hollow ones have no label, labels overlap the AS OF line | src/components/UsageChart.tsx | fixed — diamonds removed; "Crew notes" row of CSS text pills under the x-axis (EMPTY red, HALF amber, FULL green, crew words neutral), title + chart tooltip keep the quote |
| K5 | confusing | Jan 22 or later → Static water tank chart | "cm from top" line rises when water falls; legend doesn't say so | src/components/UsageChart.tsx | fixed — legend "cm from top (higher = less water)" (shown even when it is the only line) + note under the chart |
| K6 | cosmetic | Jan 23 → any chart | AS OF label clipped at the right edge: "AS OF JAN" | src/components/UsageChart.tsx | fixed — custom label: flips to the left of the line near the right edge (right of it near the left edge) |
| K7 | confusing | Jan 13 → Flags | Same event twice: engineering "Trailer tank ruptured" (critical) + commander "Water resupply mission delayed because the trailer tank broke" (warning) | src/lib/flags.ts | fixed — flags.ts merges same-day events from different reports sharing a key noun (EVENT_KEY_NOUNS); higher severity, both quotes; 2 tests |
| Q1 | wrong data | Jan 16 / Jan 17 → Static water tank card and chart footer | Card says "steady", chart says "rate 0 cm/day over 2 readings": the forecast uses the last numeric readings (Jan 13–14, 15 cm) and ignores the later EMPTY (Jan 16) and FULL (Jan 17) state words, so a pre-refill trend is shown as current | src/lib/forecast.ts | fixed — forecast gives no rate when a verified word reading follows the last number; test added |
| Q2 | cosmetic | Jan 21 or later → Static water tank chart | Y-axis ticks read 0 / 13 / 25 / 38 / 50 (12.5 and 37.5 rounded to whole numbers) | src/components/UsageChart.tsx | fixed — `niceTicks()`: a top of 5×10ⁿ splits into fifths (0/10/20/30/40/50) |
| Q3 | wrong data | Jan 16 / Jan 17 → Diesel card | Card says "steady" (4 readings of 75%) though the crew wrote "less than ¾" on both days: same cause as Q1 for text without a number | src/lib/forecast.ts | fixed — the Q1 rule covers any verified reading without a number; test added |
| Q4 | cosmetic | Jan 16 → Diesel Crew notes | A lone "less than ¾" pill was cut to "less than…" (fixed 2-day width) | src/components/UsageChart.tsx | fixed — each pill may use the gap to its nearest same-lane neighbor (max 4 days) |
| Q5 | cosmetic | Jan 13–16 → Water scenarios axis | "Jan 23" tick printed on top of "MISSION END JAN 23" | src/components/WaterScenarios.tsx | fixed — ticks within half a step of mission end are dropped |
| Q6 | confusing | Jan 16 → Flags | Message shows the raw id: "crew reported water_static empty" | src/components/FlagsList.tsx | fixed — UI-only `readableMessage()` shows "static water tank"; flags.ts text (the agent's input) unchanged |
| Q7 | wrong data | Jan 13 → Daily report (before Part C) | After K7 the recorded Jan 13 run cites `CREW_REPORTED_EVENT:none:2015-01-13:4/:5`, which now mean other flags / don't exist | data/demo/run-2015-01-13.json | fixed in Part C — every run regenerated against the final flags (no id-mapping workaround); every cited id checked to exist |

## Not fixed (feature)

None: every bug found was fixed. Seen but not a bug: Vite's "chunk larger than 500 kB" build warning
(one bundle for a one-page app; code-splitting would be an optimization, not a fix).
