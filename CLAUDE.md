# Mission Support Agent — GeauxHack 2026

An onboard assistant for crews in Mars analog habitats (MDRS, Utah). The crew gives it a daily
engineering report; Gemini extracts the readings, our code forecasts consumables and flags
anomalies, and the agent drafts a short message to Earth with only the decisions a human must make.
Demo scenario: MDRS Crew 147, January 2015, when the water resupply tank ruptured.

Deadline: Sunday Oct 25, 12:00 PM CDT (we submit by 11 AM). One developer. Scope ruthlessly.

## Product goal
A user uploads a crew engineering report and immediately sees a dashboard: usage charts per resource
over time, how long each resource will last, flags with the report quotes that justify them, and a
daily report / message to Earth. Demo: Crew 147 history preloaded, then the Jan 13 report (trailer
tank rupture) uploaded live. Replay mode (saved extractions) is the default so the demo never depends
on Gemini being up.

## Architecture rules
- `analyzeCrew(extractions, asOf)` in src/lib/analyze.ts is the single source of truth for everything
  the UI shows. CLI and UI both call it.
- Everything in src/lib/ except extract.ts is browser-safe: no fs, path, or process.
- extract.ts is server-only (holds the Gemini key); only scripts/ and api/ may import it.
- Alerts come from deterministic rules in flags.ts, never from Gemini's labels.
- Saved extractions in data/extractions/ are the fixed record; Gemini output varies between runs.

## Hard rules (hackathon — violations disqualify)
- Max 2 external APIs. We use ONE: the Gemini API. Do not add any other third-party API,
  SDK that calls a remote service, or runtime web fetch. All data is bundled in `data/`.
- All code is written during the hackathon. No copying code from external repos.
- No AI-generated images or video anywhere in the project.
- Every AI-assisted file must be logged in the README's "AI-assisted code" section
  (file path + one line on what was generated). Add the entry when you create the file.
- Malek must be able to explain every line. Keep code small and plain. Prefer standard library
  and the listed dependencies. No clever abstractions, no unrequested dependencies.

## Core design principle
The LLM reads and orchestrates. Deterministic code does all math.
- Gemini returns raw readings exactly as written, each with a `source_quote` copied from the report.
- Our code verifies every `source_quote` is a verbatim substring of the input. Unverified readings
  are flagged, never silently used.
- Unit normalization (e.g. "¾" → 75%, cm-from-top vs cm-from-bottom), forecasting, and anomaly
  rules live in TypeScript, not in prompts.
- Never invent or default a number. Missing data stays `null` and is shown as missing.

## Stack
- React + Vite + TypeScript (frontend), deployed on Vercel.
- Vercel serverless functions in `api/` hold the Gemini key (later phase).
- `@google/genai` (Gemini SDK), `zod` (validation), `tsx` (run scripts).
- Model name comes from env `GEMINI_MODEL`; key from `GEMINI_API_KEY`. Never hardcode either.

## Layout
- `data/reports/<crew>/` — saved MDRS reports as .txt (source URLs in `data/SOURCES.md`)
- `data/extractions/` — saved Gemini outputs (used for demo replay mode)
- `src/lib/` — shared logic: schema, normalize, forecast, flags
- `scripts/` — CLI scripts for testing pieces without the UI
- `api/` — serverless functions (later)
- `prompts/` — phase instructions given to Claude Code (documentation only; do not modify).

## Conventions
- TypeScript strict. Small pure functions with a one-line comment saying what they do.
- Comment extensively for a reader learning the codebase: a header comment at the top of every file explaining what it does and how it fits into the system; a doc comment on every function (what it does, inputs, outputs, why it exists); and inline comments on any line using a library API, a regex, a type trick, or a non-obvious decision. Comments explain why, not just what. Never change logic while commenting.
- When a phase is done, stop and summarize what changed. Do not start the next phase unasked.
- At the end of every phase, rewrite the Current state section (replace it, don't append).

## Current state
- **Status:** Phase 3a complete. The analysis core is finished and the **data contract is frozen**:
  `src/lib/report-types.ts` (DailyReport, AgentTraceStep, DemoRun), the `Analysis` type in
  `src/lib/analyze.ts`, and the fixtures in `data/demo/`. Phase 3b (agent + API) and Phase 4 (UI) build
  against these. Type check, build, 29 tests, lint and the src/lib browser-safety grep all pass. Not committed.
- **Gemini API:** paid tier, prepaid credits, auto-reload off.
- **Data:** all 11 Crew 147 engineering reports (Jan 12–19, 21–23) and 10 commander reports (Jan 12–19,
  22, 23) are extracted, every quote verified. `final-mission-report.txt` is reference only.
- **Analysis now:**
  - `analyzeCrew(extractions, asOf, crew)` merges each day's reports: all readings kept (engineering first,
    each tagged `report_kind`); the series point per resource is the first USABLE reading (number or status),
    so engineering wins and commander fills gaps (water_total); every quote kept as tagged `evidence`; events
    and questions are the union, tagged. One report per (date, kind); a later duplicate replaces it.
  - normalize: "~360l" → 360 L `approximate: true`; whole-text "empty"/"half"/"half-empty"/"full" → `status`,
    value null (fuels too — no more full → 100). Bounds ("less than ¾") still null. "filled" is not a status.
  - Refill in the series: a jump above threshold, or status "full" after an "empty"/"half" or a fall since
    the last fill.
  - Flags have ids `TYPE:resource|none:date`, with `:2`, `:3` when repeated in one analysis (e.g. several
    crew events per day). TANK_EMPTY_REPORTED (critical) looks at the latest day only. RUNS_OUT is critical with
    ≥3 readings, else warning "early estimate — based on 2 readings".
  - MISSING_READING only for `DAILY_ENGINEERING_RESOURCES` (diesel, propane, water_static, in constants.ts);
    occasional resources (water_total, loft/trailer form numbers) never trigger it.
  - Crew identity from `CREW_147` in constants.ts (size 7 from the Final Mission Report roster; mission_end
    2015-01-23 = last engineering report). Never from extractions.
  - `waterScenarios` (water.ts): latest water_total ≤ asOf, null if any water series shows a refill after it.
    Day counts start at the reading date.
- **Demo numbers:** as of Jan 13: CRITICAL trailer-tank rupture event; propane RUNS_OUT is a WARNING (2
  readings); water ~360 L / 7 crew → FMARS 12.12 L → 4.2 days → runs out 2015-01-17; NASA 2.5 L → 2015-02-02;
  5.14 L/person/day needed to reach Jan 23. Retrospective check (CLI only): Jan 16 commander "we will run out
  of water tomorrow" = Jan 17, matching the FMARS date. As of Jan 16: TANK_EMPTY_REPORTED water_static (from
  the commander report). As of Jan 18: water scenarios null, "last volume estimate predates a refill".
- **Demo fixtures:** `data/demo/manifest.json` (preload through Jan 12, upload Jan 13 engineering +
  commander). `analysis-2015-01-12.json` / `-13.json` are real output — regenerate with `npm run build-demo`
  after any analysis or extraction change. `run-2015-01-13.json` is a hand-written SAMPLE (`is_sample: true`,
  only numbers and flag ids from analysis-2015-01-13.json); Phase 3b overwrites it with a real run.
- **Still not forecastable:** water_static (no total depth; trend only), water_loft/water_trailer (no unit),
  gasoline (never a level), water_total (one data point — scenarios only, no rate).
- **Other decisions kept:** rates are amount change per day (negative = used up; "from the top" flips sign);
  event severity from keyword rules on verified quotes; dates normalized in TypeScript; `.npmrc`
  legacy-peer-deps; `/lib/` anchored in `.gitignore`; Gemini's `crew` field is ignored.
- **Next:** Phase 3b (agent + API) when asked.
