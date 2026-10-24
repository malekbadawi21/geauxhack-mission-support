Read CLAUDE.md first and follow it. This is Phase 1: scaffold + extraction spike. No UI work yet.

## Goal
Prove Gemini can reliably turn one real MDRS engineering report into validated, traceable JSON.

## Tasks
1. Scaffold a Vite + React + TypeScript app in the repo root (keep the existing README.md and
   .gitignore). Use npm. Make sure `.gitignore` includes `.env` and `node_modules`.
2. Install: `@google/genai`, `zod`, and dev dependency `tsx`.
3. Create `.env.example` with `GEMINI_API_KEY=` and `GEMINI_MODEL=` (no values).
4. Create `src/lib/schema.ts` with a zod schema and exported TypeScript types:
   ```
   Extraction {
     report_date: string | null        // YYYY-MM-DD if stated
     crew: string | null
     author: string | null
     readings: Reading[]
     events: Event[]                   // resupply issues, leaks, failures
     questions_to_mission_support: string[]
   }
   Reading {
     resource: "diesel" | "propane" | "water_static" | "water_loft" | "water_trailer"
             | "gasoline" | "other"
     raw_text: string                  // the value exactly as written, e.g. "¾", "15cm"
     value: number | null              // number as written; "¾" -> 0.75; null if not numeric
     unit: "percent" | "fraction" | "cm" | "in" | "gal" | "L" | "other" | null
     measured_from: "top" | "bottom" | null   // only if the report says so
     source_quote: string              // verbatim span from the report containing this reading
   }
   Event {
     type: "resupply_issue" | "leak" | "equipment_failure" | "other"
     description: string
     source_quote: string
   }
   ```
5. Create `src/lib/extract.ts` exporting `extractReport(text: string): Promise<Extraction>`:
   - Calls Gemini via `@google/genai` with JSON output constrained to the schema
     (`responseMimeType: "application/json"` + a response schema).
   - System instruction: extract only what is written; copy source_quote verbatim; never infer
     or convert values; use null when unsure.
   - Parses the response with zod. On parse failure, throw an error that includes the raw response.
6. Create `src/lib/verify.ts` exporting `verifyQuotes(text, extraction)`:
   returns each reading/event with `verified: boolean` (true only if `source_quote` is an exact
   substring of `text` after collapsing whitespace on both sides).
7. Create `scripts/extract.ts`, run as `npm run extract -- <path-to-report.txt>`:
   - Loads `.env`, reads the file, runs extract + verify.
   - Prints a readable table: resource, raw_text, value, unit, measured_from, verified.
   - Prints events and questions.
   - Saves the full JSON to `data/extractions/<same-filename>.json`.
8. Add the README "AI-assisted code" section and log every file you created.

## Test input
`data/reports/crew-147/2015-01-13-engineering.txt` (Malek will create this).

## Done when
- `npm run extract -- data/reports/crew-147/2015-01-13-engineering.txt` prints the table.
- Diesel, propane, and static tank readings are extracted with correct raw_text.
- Every source_quote verifies, or unverified ones are clearly marked.
- Then stop and summarize. Do not build normalization, forecasting, or UI yet.
