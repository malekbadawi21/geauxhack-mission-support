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
- **Status:** Phase 2 complete except 3 extractions (deterministic pipeline, CLI only). `npm run extract-all`,
  `npm run analyze -- crew-147 --as-of <date>`, `npm test`, and the build all work. Saved extractions exist
  for Jan 12–19 (8 of 11 reports). **Jan 21, 22, 23 are NOT extracted:** the Gemini free tier allows
  20 requests/day and it ran out. Re-run `npm run extract-all -- data/reports/crew-147` (no `--force`) after
  the quota resets; it extracts only the missing three and rewrites the survey.
- **Demo before/after works:** as of Jan 12 → only "main water tank is empty" (warning). As of Jan 13 →
  CRITICAL trailer-tank rupture flag with its quote, plus CRITICAL "propane runs out before mission end"
  (45% → 40% in one day; based on only 2 readings, and the flag says so).
- **What the survey revealed:** diesel is "¾" then "less than ¾" (a bound → null) then "60%"; propane is
  always "NN%". The static tank is "15cm" (no top/bottom) through Jan 14, then "Less than 10cm" (bound), "Full"
  on Jan 17 (refill, no cm value), then "N cm from the top" from Jan 18. Jan 12's "Water well ¼" was labeled
  static tank by Gemini but the quote never names it, so normalize rejects it. The Jan 17 refill form gives
  bare numbers (85/95, 25/50, 140/15) with no units → null. Loft tank is only ever "filled"; gasoline is
  never a level.
- **Not forecastable, and why:**
  - water_static: days-to-empty undefined. Early readings don't say top/bottom; later ones are "from the
    top" with no total tank depth. A trend (cm/day) only.
  - water_loft, water_trailer: no numeric reading with a unit (only "filled", or unitless form numbers).
  - gasoline: never reported as a level.
  - Water use in liters can't be computed (no capacity or volume anywhere), so `baselines.ts` is unused.
- **Decisions made:**
  - Rates are AMOUNT change per day (negative = used up). "From the top" depths flip sign, so a refill
    there is a big drop in the number.
  - Normalize parses raw_text itself and ignores Gemini's value/unit; measured_from comes from the quote's
    wording. Unverified quotes, a raw_text not inside its quote, or a tank quote that doesn't name the tank → null.
  - Event severity comes from keyword rules on the verified quote (constants.ts), never Gemini's `type`.
  - MISSION_END_DATE = 2015-01-23, the date of the last Crew 147 report we have (not an official end date).
  - Retry also covers 504 (seen in the batch run). Daily-quota 429s still burn their 3 retries (harmless).
  - Date normalization (e.g. "01/13/2015" → YYYY-MM-DD) happens in TypeScript, not the prompt.
  - `.npmrc` sets `legacy-peer-deps=true` to work around an npm 10 install crash ("reading 'edgesOut'").
  - No image/media files; favicon is an inline SVG. `.gitignore` `lib/` anchored to `/lib/`.
- **Known gaps:** `data/SOURCES.md` lists a URL only for the Jan 13 report. "other" readings (trash
  bags, water meter) are shown but not charted or forecast.
- **Next:** extract Jan 21–23 once quota resets, then Phase 3 (UI) when asked.
