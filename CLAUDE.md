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
- **Status:** Phase 8 (bug fixes) complete and pushed. `npm run qa` 168 checks, 0 problems at 1920 and
  1280; type check, build, 51 tests, lint, `vercel build` pass.
- **Phase 8:** grounding.ts checks clock times as one value (all 11 saved runs still 0 ungrounded); agent
  told not to state times/schedules absent from tools or UI terms. "Water on hand" is no longer charted:
  a "Crew volume estimates" row lists them. api/daily-report does NOT re-run on ungrounded numbers
  (only the CLI does); a live run shows them instead.
- **Water (water.ts):** `waterStatus(series, forecasts, asOf, crew)` → `analysis.water`, three modes.
  "projected" (Jan 13–16): the ~360 L estimate minus crew × rate × days since it, per FMARS/NASA rate;
  remaining clamps at 0; `runs_out_on` fixed from the estimate date; `budget_to_mission_end` (null once
  mission end ≤ asOf). "since_refill" (Jan 17+): days since refill, static-tank trend from forecast.ts
  (≥2 from-top readings since the refill: Jan 19+), estimated water USED, `missing` line; no remaining.
  "none" (Jan 12). `waterScenarios`/`latestWaterVolume` are gone.
- **UI:** `WaterPanel.tsx` (replaced WaterScenarios.tsx) names the mode in its title; the "Water on hand"
  card follows the same mode. Resources with no number (loft, trailer tanks) get a "Crew notes only" row
  instead of a chart. Chart x-axis = day numbers with the month once (`DayTick`), Recharts thins them.
- **Agent:** tool `get_water_status` (returns `analysis.water`); overview has `water_status_mode`. All 11
  replay runs regenerated: 0 ungrounded numbers, ≤3 decisions, 90–117-word messages; every since-refill
  day asks the crew for a volume estimate; projected days call the numbers projections.
- **Gemini API:** paid tier, prepaid credits, auto-reload off. Model from env `GEMINI_MODEL`
  (`gemini-3.8-flash`), called directly with `@google/genai`.
- **Vercel:** CLI linked (project `geauxhack-mission-support`, Vite, Node 24), env vars set for all
  environments; root tsconfig.json has its own compilerOptions; `data/style/` via `includeFiles`.
- **Bugs:** `docs/bugs.md` (Phase 6, all 14 fixed). QA: `scripts/qa.ts` (Playwright, dev-only) → `qa-output/`.
- **Stale CLI output:** `data/extractions/crew-147-analysis-*.json` still have the old water fields
  (written by `npm run analyze`, not read by the app or tests); re-run analyze to refresh if wanted.
- **Still not forecastable:** water_static days-to-empty (from-top depth, no tank depth), loft/trailer
  tanks, gasoline; water_total only via the water status.
- **Next:** Malek reviews and commits; deploy (`vercel --prod`) and smoke-test both modes; replace the
  favicon; pick the product name (`src/ui/config.ts`).
