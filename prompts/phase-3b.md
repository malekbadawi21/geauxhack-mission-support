Read CLAUDE.md first and follow it. This is Phase 3b: the agent loop, the API, and the real demo run.
Runs LOCALLY (needs the Gemini key). Phase 4 (UI) is being built in parallel in another session.

## File ownership (do not cross)
- You own: api/**, src/lib/agent/**, src/lib/grounding.ts, scripts/daily-report.ts, data/demo/run-*.json,
  tests for your files, README, CLAUDE.md.
- Do NOT edit: src/App.tsx, src/main.tsx, src/components/**, src/ui/**, src/styles/**, index.html.
- Do NOT change the contract (src/lib/report-types.ts, the Analysis type). If you believe it must change,
  stop and tell Malek first.

## Tasks
1. api/extract.ts (Vercel serverless function)
   - POST { filename: string, text: string } → { extraction, verification, report_date, kind }
     where kind is "engineering" | "commander" inferred from the filename or text.
   - Uses extractReport + verifyQuotes + date normalization. Reject empty or >50 KB text (400).
     Gemini failure after retries → 502 with a clear message.
   - Set a generous maxDuration for the function and note it in a comment.
2. src/lib/agent/tools.ts (server-only)
   Tool declarations for Gemini function calling plus their implementations. All tools read from an
   Analysis computed by analyzeCrew; none call Gemini.
   - get_overview() → overall counts, latest readings, forecasts, flags (ids, severity, message)
   - get_resource_history({ resource }) → that resource's series
   - get_flag_evidence({ flag_id }) → the flag with its quotes and report kinds
   - get_water_scenarios() → waterScenarios or the null reason
   - submit_daily_report({ ...DailyReport minus grounding }) → ends the loop
3. src/lib/agent/loop.ts (server-only): `runAgent(analysis): Promise<{ report, trace }>`
   - Uses @google/genai function calling. Check the installed SDK's types in node_modules for the exact
     API (tools / functionDeclarations / function call parts) instead of guessing.
   - Max 5 model turns. If the cap is reached without submit_daily_report, make one final call that
     forces submit_daily_report.
   - Record an AgentTraceStep per tool call (tool, short input/output summaries, ms).
   - System instruction: you are onboard mission support for an analog Mars habitat crew; investigate
     with tools before writing; use ONLY numbers that appear in tool results; reference flag ids in
     concerns; message_to_earth is self-contained (≤120 words) because replies take ~20+ minutes each
     way on Mars; put anything needing human authority in decisions_for_earth.
   - If data/style/ideal-message-2015-01-13.md exists, include it in the system instruction as a tone and
     length example (not content to copy).
   - Validate the submitted report with the zod schema; on failure, one retry with the validation error.
4. src/lib/grounding.ts (browser-safe, pure): `checkGrounding(report, toolOutputs)`
   - Extract every number from the report's text fields; collect every number from the tool outputs the
     agent actually received.
   - A report number is grounded if it matches a tool number exactly, or within rounding (|a−b| ≤ 0.5,
     or within 1% for numbers > 50). Dates/years that appear in the data count as grounded.
   - Return { numbers_checked, ungrounded: string[] } and attach it to report.grounding.
5. api/daily-report.ts (Vercel serverless function)
   - POST { extractions: Extraction[], as_of: string } → runs analyzeCrew, runAgent, checkGrounding
     → { analysis, report, trace }.
6. scripts/daily-report.ts, npm script `daily-report`
   - `npm run daily-report -- crew-147 --as-of 2015-01-13` loads saved extractions, runs the same
     pipeline, prints the report, the trace and the grounding result, and writes a real DemoRun to
     data/demo/run-2015-01-13.json with is_sample: false (this replaces the sample — it is now the
     fixed replay record). Run it once successfully.
7. Tests: grounding (exact match, rounding, ungrounded detection, dates allowed). Tool implementations
   return the right slices of an Analysis fixture.
8. Local API check: with `vercel dev` running, curl both endpoints once using the Jan 13 files and show
   the responses (trim long output). If vercel dev isn't set up, say so and skip — don't block.

## Done when
- `npm run daily-report -- crew-147 --as-of 2015-01-13` prints a report with 0 ungrounded numbers
  (or lists them honestly) and writes data/demo/run-2015-01-13.json.
- Type check, build, tests, and the grep check pass (extract.ts and src/lib/agent/** are server-only
  and may use process; nothing browser-side imports them).
- README AI log and Current state updated. Stop and summarize. Don't commit.
