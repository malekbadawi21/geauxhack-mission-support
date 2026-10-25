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
- **Status:** Phase 3b complete (agent + API + real demo run). Phase 4 (UI) is being built in a parallel
  session. Data contract unchanged (`report-types.ts`, `Analysis`). Type check, build, 41 tests, lint and
  the browser-safety greps pass. Not committed.
- **Gemini API:** paid tier, prepaid credits, auto-reload off. Model `gemini-3.8-flash` (from `.env`).
- **Data:** all 11 Crew 147 engineering reports (Jan 12–19, 21–23) and 10 commander reports (Jan 12–19,
  22, 23) extracted, every quote verified. `final-mission-report.txt` is reference only.
- **Analysis (Phase 3a, unchanged):** `analyzeCrew(extractions, asOf, CREW_147)` merges each day's
  engineering + commander reports (engineering wins, commander fills gaps); flag ids `TYPE:resource|none:date`
  (+`:2`, `:3`); RUNS_OUT critical only with ≥3 readings; water scenarios from the last `water_total`
  (null after a refill). Crew identity from `CREW_147`, never from extractions.
- **Agent (`src/lib/agent/`, server-only, excluded from the browser tsconfig):**
  - `tools.ts`: `get_overview`, `get_resource_history`, `get_flag_evidence`, `get_water_scenarios` — pure
    reads of an Analysis; `submit_daily_report` takes `DailyReportSchema` minus `grounding`.
  - `loop.ts`: `runAgent` = ≤5 AUTO function-calling turns, then one forced (ANY) submit. The turn before
    the forced call gets a plain "submit the complete report now" note — without it Gemini answered the
    forced call with an empty stub every time. Validation: zod + flag ids exist + every critical flag in a
    concern + status_line ≥3 words + message ≥40 words (our floors); `as_of` and `overall` are set by our
    code (overall from flag severities). One retry with the error. `runDailyReport` adds grounding.
  - System instruction includes `data/style/ideal-message-2015-01-13.md` as rules (bundled via vercel.json).
  - Temperature left at the SDK default (Gemini 3 guidance); runs vary, the saved run is the record.
- **Grounding (`src/lib/grounding.ts`, browser-safe):** every number in the report's text vs every number
  (fields and numbers inside strings) in the tool outputs the agent received; exact, ±0.5, or 1% above 50.
  Dates ground through their parts. Word numbers ("two") are not checked. In testing it caught an invented
  "19:00" next-update time.
- **API (`api/`):** Web-standard `export function POST(request)`, `config.maxDuration = 300`, no Vercel
  package. `extract.ts`: `{ filename, text }` → `{ extraction, verification, report_date, kind }`, kind from
  filename then the report's first 200 chars; `source_file` is canonical `<date>-<kind>.txt` (analyzeCrew reads
  the kind from it); 400 empty/>50 KB/bad body/no kind, 502 Gemini failure. `daily-report.ts`:
  `{ extractions, as_of }` → `{ analysis, report, trace }`. `vercel` CLI isn't installed: both handlers were
  tested by calling `POST(new Request(...))` directly in Node (all status codes as expected). Not yet tested
  on Vercel itself — `.ts` import extensions and the project-references tsconfig are the deploy risks.
- **Demo fixtures:** `data/demo/run-2015-01-13.json` is now a REAL run (`is_sample: false`): 13 trace steps,
  4 concerns, 93-word message, 53 numbers checked, 0 ungrounded. Regenerate with
  `npm run daily-report -- crew-147 --as-of 2015-01-13` (output varies per run). `analysis-*.json` via
  `npm run build-demo`. A live re-extraction of Jan 13 can differ from the saved one (once 5 flags, not 6).
- **Still not forecastable:** water_static (no total depth), water_loft/water_trailer (no unit), gasoline,
  water_total (one point — scenarios only).
- **Other decisions kept:** rates are change per day (negative = used up); event severity from keyword rules
  on verified quotes; `.npmrc` legacy-peer-deps; `/lib/` anchored in `.gitignore`; Gemini's `crew` ignored.
- **Next:** Phase 4 UI wiring to the API / replay files; a Vercel deploy check.
