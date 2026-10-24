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
- **Status:** Phase 2 complete, plus a data pass for commander reports. All 11 Crew 147 engineering
  reports (Jan 12–19, 21–23) and 10 commander reports (Jan 12–19, 22, 23) are extracted with every quote
  verified. `npm run analyze`, `npm test`, type check, build and lint all pass.
- **Gemini API:** paid tier, prepaid credits, auto-reload off.
- **Demo before/after works:** as of Jan 12 → "main water tank is empty" (warning). As of Jan 13 →
  CRITICAL trailer-tank rupture flag with its quote, plus CRITICAL "propane runs out before mission end"
  (45% → 40% in one day; based on only 2 readings, and the flag says so). By Jan 23: diesel and propane
  ~22 days from empty; static tank trend -5 cm/day.
- **Data sources:** `npm run fetch-reports` (scripts/fetch-reports.ts, dev-only, never imported by the
  app) downloads the commander reports and `final-mission-report.txt` (reference only, never extracted)
  and logs each URL in data/SOURCES.md. Its HTML→text output matched the hand-saved Jan 13 engineering
  report line for line (only the page-title line is extra). Engineering reports other than Jan 13 were
  saved by hand and have no URL in SOURCES.md yet.
- **What the surveys revealed:**
  - Engineering: diesel "¾" → "less than ¾" (bound → null) → "60%"…"50%"; propane always "NN%". Static
    tank "15cm" (no top/bottom) to Jan 14, "Less than 10cm" (bound), "Full" Jan 17 (refill, no cm value), then
    "N cm from the top" Jan 18–23. Jan 12 "Water well ¼" is rejected (quote never names the static tank).
    The Jan 17 refill form has unitless numbers → null. Loft is only "filled"; gasoline never a level.
  - Commander: the ONLY water quantity is Jan 13 "~360l" (water_total, approximate). Jan 16 "empty" /
    "half-empty" and Jan 17 "full" are words for static/loft. "350l" on Jan 13 is a proposed bottle drop, not
    a reading. So there is no water volume time series. Gemini's `crew` field read "115"/"117" from page
    titles on two commander reports — don't trust or use it.
  - Crew roster (Final Mission Report table): Romain Charles (Commander), Renee Garifi (XO), Wissam
    Rammo (HSO), Andrew Henry (Journalist), Rebeca Rodriguez (Engineer), Danielle DeLatte (Scientist),
    Scott MacPhee (Astronomer). No report states the crew size as a number; the table has 7 rows.
- **Not forecastable, and why:**
  - water_static: days-to-empty undefined (early readings don't say top/bottom; later ones are "from the
    top" with no total tank depth). Trend only.
  - water_loft, water_trailer: no numeric reading with a unit.
  - gasoline: never reported as a level.
  - water_total: one data point (Jan 13 "~360l"). normalize.ts currently returns null for it because "~"
    makes it an estimate. Liters per crewmember (baselines.ts) is therefore still not computed.
- **Decisions made:**
  - Schema: resource `water_total`; reading field `approximate` (required from Gemini; optional on saved
    files, because Jan 12–19 engineering extractions predate it — missing means "not assessed").
  - extract-all extracts only `YYYY-MM-DD-<kind>.txt`, stops the batch on a quota/billing error, and splits
    the survey by kind. Retries cover 429/503/504 (2s/4s/8s), 60s request timeout.
  - `npm run analyze` loads engineering reports only: analyzeCrew keeps one report per date, so a commander
    report would replace that day's engineering report. Merging the kinds is an open decision.
  - Rates are AMOUNT change per day (negative = used up); "from the top" depths flip sign.
  - Normalize parses raw_text itself; measured_from comes from the quote's wording. Unverified quotes,
    raw_text not inside its quote, or a tank quote that doesn't name the tank → null.
  - Event severity comes from keyword rules on the verified quote (constants.ts), never Gemini's `type`.
  - MISSION_END_DATE = 2015-01-23, the date of the last Crew 147 report (not an official end date).
  - Dates normalized in TypeScript. `.npmrc` legacy-peer-deps (npm 10 crash). No image/media files.
    `.gitignore` `lib/` anchored to `/lib/`.
- **Open questions for Malek:** should approximate values ("~360l") be used with an "approximate" mark
  instead of null? How should commander reports merge with same-day engineering reports in analyzeCrew?
- **Next:** Phase 3 (UI) when asked.
