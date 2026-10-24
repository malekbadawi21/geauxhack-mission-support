Read CLAUDE.md first and follow it. This is Phase 3a: finish the analysis core and freeze the data
contract that Phase 3b (agent + API) and Phase 4 (UI) will both build against. Local only. No UI, no agent.

## Decisions (made by Malek — implement exactly)
1. Approximate values count. "~360l" → 360 L with `approximate: true`. Never drop a value just because
   it is approximate; the UI will label it.
2. Qualitative tank states are kept as a `status`, not a number:
   "empty" → "empty", "half-empty"/"half" → "half", "full" → "full". `value` stays null.
3. A day can have several reports (engineering + commander). analyzeCrew groups extractions by date:
   - Numeric readings: if both reports give the same resource, the engineering report wins (the
     engineer measured it). Commander readings fill resources the engineering report lacks
     (e.g. water_total).
   - Keep every contributing source_quote as evidence, tagged with the report kind it came from.
   - Events and questions: union of both reports, each tagged with its report kind.
   - Remove the "engineering reports only" loading from scripts once merging works.
4. Crew identity comes from config, never from extraction (Gemini returned page numbers as crew).
   In constants.ts:
   CREW_147 = { name: "MDRS Crew 147", size: 7, mission_end: "2015-01-23",
     size_source: "Final Mission Report crew roster table (7 members)",
     size_url: "https://mdrs2013.marssociety.org/home/crew-147/final-mission-report",
     mission_end_source: "date of last engineering report" }

## Tasks
1. normalize.ts: implement decisions 1 and 2. Add `approximate` and `status` to NormalizedReading.
2. flags.ts:
   - TANK_EMPTY_REPORTED (critical): any reading with status "empty", evidence = its quote.
   - RUNS_OUT_BEFORE_MISSION_END: "critical" only with ≥3 readings; with 2 readings it is a "warning"
     and the message says "early estimate — based on 2 readings".
   - Give every flag a stable `id`: `${type}:${resource ?? "none"}:${date}`.
   - A status "full" reported after an "empty" (or after a fall) counts as a refill in the series.
3. analyze.ts: implement decision 3 (merge by date). Series points can now carry `status` and
   `approximate`.
4. New src/lib/water.ts (browser-safe): `waterScenarios(analysisInputs, asOf, crew)`:
   - Uses the most recent water_total reading on or before asOf.
   - If a refill (status "full" or a jump) happened AFTER that reading and on/before asOf, return
     `null` with reason "last volume estimate predates a refill".
   - Otherwise return:
     { volume_l, approximate, reading_date, source_quote, crew_size, crew_size_source,
       days_until_mission_end,
       scenarios: [
         { id: "fmars_average", label: "Arctic analog average (FMARS)", rate_l_per_person_day: 12.12,
           days_left, runs_out_on },
         { id: "nasa_minimum", label: "NASA potable-water minimum", rate_l_per_person_day: 2.5,
           days_left, runs_out_on } ],
       required_rate_to_mission_end_l_per_person_day,
       notes: [
         "Volume is a crew estimate (approximate)" (only if approximate),
         "FMARS figure is measured per sol (24h 39m) at a different analog station; used as a reference, not a prediction",
         "NASA figure is a minimum for drinking water only, not total use" ] }
   - Rates come from baselines.ts (keep their source URLs). days_left = volume / (crew_size × rate).
     runs_out_on = reading_date + floor(days_left) days.
   - Add `waterScenarios` (or null + reason) to the Analysis type.
5. Data contract — new file src/lib/report-types.ts (zod schemas + exported types, browser-safe):
   ```
   DailyReport {
     as_of: string
     overall: "nominal" | "caution" | "critical"
     status_line: string                     // one sentence
     concerns: { title, detail, flag_ids: string[] }[]
     crew_actions: string[]
     decisions_for_earth: { decision, why }[]
     message_to_earth: string                // self-contained, ≤120 words
     grounding: { numbers_checked: number, ungrounded: string[] }
   }
   AgentTraceStep { step: number, tool: string, input_summary: string, output_summary: string, ms: number }
   DemoRun { as_of: string, report: DailyReport, trace: AgentTraceStep[], generated_at: string,
             model: string, is_sample: boolean }
   ```
6. Demo fixtures in data/demo/ (create the folder):
   - manifest.json: { crew: "crew-147", preload_through: "2015-01-12", upload_day: "2015-01-13",
     upload_files: ["2015-01-13-engineering.txt", "2015-01-13-commander.txt"] }
   - analysis-2015-01-12.json and analysis-2015-01-13.json: REAL output of analyzeCrew.
   - run-2015-01-13.json: a hand-written SAMPLE DemoRun with `is_sample: true`, using only numbers and
     flag ids that appear in analysis-2015-01-13.json, and a 3–4 step sample trace. Phase 3b will
     overwrite this file with a real run.
7. CLI: `npm run analyze -- crew-147 --as-of 2015-01-13` also prints the water scenarios, and after them
   a "retrospective check" line: the FMARS-rate runs_out_on date next to any later commander quote that
   mentions running out of water (search the saved extractions for "run out"). CLI only.
8. Tests: approximate kept; status parsing; merge prefers engineering numbers; flag severity with 2 vs 3
   readings; water scenarios math; scenarios return null after a later refill.

## Done when
- `npm run analyze -- crew-147 --as-of 2015-01-13` shows merged readings, water scenarios and the
  retrospective check; `--as-of 2015-01-18` shows water scenarios as null with the refill reason.
- data/demo/ contains the four files above.
- Type check, build, tests, and the src/lib grep check pass.
- README AI log updated; Current state rewritten (say the contract is frozen: report-types.ts,
  Analysis type, data/demo/).
- Stop and summarize. Don't commit.
