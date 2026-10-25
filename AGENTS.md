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
- `prompts/` — phase instructions given to Codex (documentation only; do not modify).

## Conventions
- TypeScript strict. Small pure functions with a one-line comment saying what they do.
- Comment extensively for a reader learning the codebase: a header comment at the top of every file explaining what it does and how it fits into the system; a doc comment on every function (what it does, inputs, outputs, why it exists); and inline comments on any line using a library API, a regex, a type trick, or a non-obvious decision. Comments explain why, not just what. Never change logic while commenting.
- When a phase is done, stop and summarize what changed. Do not start the next phase unasked.
- At the end of every phase, rewrite the Current state section (replace it, don't append).

## Current state
- **Status:** Phase 6 complete (QA sweep, bug fixes, a daily report per day). `npm run qa` (needs `npm run dev`)
  passes: 144 checks, 0 console errors / exceptions / blank pages, a daily report on every day, both
  viewports. Type check, build, 47 tests, lint, browser-safety grep and `vercel build` pass. Not committed.
- **Bugs:** `docs/bugs.md` lists all 14 (7 known K1–K7, 7 found by QA Q1–Q7), all fixed.
- **QA:** `scripts/qa.ts` (Playwright, dev-only) drives the local dev server; screenshots + results.json go
  to `qa-output/` (gitignored). Chromium is installed with `npx playwright install chromium`.
- **Gemini API:** paid tier, prepaid credits, auto-reload off. Model from env `GEMINI_MODEL`
  (`gemini-3.8-flash`). Called directly with `@google/genai` — no Vercel AI Gateway.
- **Vercel:** CLI linked (project `geauxhack-mission-support`, Vite, Node 24). `GEMINI_API_KEY` and
  `GEMINI_MODEL` set for all environments. Root tsconfig.json has its own compilerOptions with
  `rewriteRelativeImportExtensions` (Vercel compiles api/ with it and ignores `references`).
  `data/style/` reaches the daily-report function via `includeFiles`.
- **UI:** every section sits in an `ErrorBoundary` ("This section failed to render" + message, resets on
  day change). Replay shows `data/demo/run-<date>.json` for the selected day instantly; only the Jan 13
  upload plays the staged animation; Live never shows a recorded run. Chart words (EMPTY/HALF/FULL, "less
  than ¾") are a "Crew notes" row of CSS pills under the x-axis; no custom SVG anywhere.
- **Analysis changes this phase:** same-day engineering + commander events sharing a key noun
  (`EVENT_KEY_NOUNS`, constants.ts) merge into one flag; forecasts give no rate when the crew described
  the level in words after the last number; `latestWaterVolume()` (water.ts) is the one staleness rule
  for the water card and the scenarios (reason now names both dates).
- **Demo replay:** one real run per report day (Jan 12–23, 11 files), regenerated with
  `npm run daily-report -- crew-147 --all --force` against the final flags: 0 ungrounded numbers on every
  day, ≤3 decisions, 93–116-word messages, every cited flag id exists, every critical flag cited.
- **Still not forecastable:** water_static (cm, top/bottom unstated before Jan 18; from-top after),
  water_loft/water_trailer, gasoline, water_total (scenarios only).
- **Next:** Malek reviews and commits; deploy (`vercel --prod`) and smoke-test both modes; replace the
  favicon; pick the product name (`src/ui/config.ts`).
