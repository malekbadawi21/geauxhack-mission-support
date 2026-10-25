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
- **Status:** Phase 5 complete: Phase 4 UI merged into main (no conflicts), UI wired to the real API, rule
  check clean, deploy-ready. Type check, build, 42 tests, lint, browser-safety greps and `vercel build`
  pass. Not committed, not pushed, not yet deployed.
- **Gemini API:** paid tier, prepaid credits, auto-reload off. Model from env `GEMINI_MODEL`
  (`gemini-3.8-flash`). Called directly with `@google/genai` — no Vercel AI Gateway.
- **Vercel:** CLI installed and linked (project `geauxhack-mission-support`, framework Vite, Node 24).
  `GEMINI_API_KEY` and `GEMINI_MODEL` set for Production, Preview and Development. Deploy with
  `vercel --prod` or a GitHub import; no other env vars needed.
- **Vercel build gotcha (fixed):** Vercel compiles api/ with the ROOT tsconfig.json's compilerOptions and
  ignores `references`. Root tsconfig.json now has its own compilerOptions (mirroring tsconfig.node.json)
  with `rewriteRelativeImportExtensions`, so our `.ts` imports become `.js` in the output. Without it the
  functions crash with ERR_MODULE_NOT_FOUND. Proven by running the `vercel build` output in Node.
  `data/style/` reaches the daily-report function via `includeFiles` (shows as `filePathMap`).
- **UI (`src/ui/`, `src/components/`):** Replay (default; saved extractions + `data/demo/run-*.json`) and
  Live (`/api/extract` per file, then `/api/daily-report`). `pipeline.ts` validates both replies with zod
  schemas matching the API exactly; the UI recomputes the Analysis itself with `analyzeCrew` (the API's
  `analysis` field is ignored). SAMPLE badge only when `is_sample` is true.
- **Competition rule (no AI images):** no image files; no hand-drawn SVG in src/. Charts are Recharts
  (markers via its `Dot`/`Symbols`/`Text`/`Layer`), icons are lucide (brand mark = `Orbit`), the legend
  swatch is CSS. The inline SVG favicon in index.html is Malek's to replace by hand.
- **Data:** all 11 Crew 147 engineering reports and 10 commander reports extracted, every quote verified.
- **Analysis (unchanged since 3a):** `analyzeCrew(extractions, asOf, CREW_147)` merges each day's reports
  (engineering wins); flag ids `TYPE:resource|none:date`(+`:2`); RUNS_OUT critical only with ≥3 readings.
- **Agent (`src/lib/agent/`, server-only):** ≤5 tool turns + forced submit, one validation retry,
  grounding check. `decisions_for_earth` ≤ 3 (`MAX_DECISIONS_FOR_EARTH`, enforced in `DailyReportSchema`):
  only Earth-authority decisions on crew safety, water, power or schedule; minor logistics → crew_actions.
- **Demo replay:** `data/demo/run-2015-01-13.json` regenerated (real run): 13 trace steps, 3 concerns,
  3 decisions, 99-word message, 51 numbers checked, 0 ungrounded.
- **Live timings (vercel dev):** extract 9–32 s per report, daily-report ~110 s (limit 300 s). Live runs vary
  from the saved record (once 7 flags instead of 6) — Replay stays the demo default.
- **Still not forecastable:** water_static, water_loft/water_trailer, gasoline, water_total (scenarios only).
- **Next:** Malek reviews, commits and pushes; deploy (`vercel --prod`) and smoke-test both modes on the
  deployed URL; replace the favicon; pick the product name (`src/ui/config.ts`).
