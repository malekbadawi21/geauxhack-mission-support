Bug fixes only — no new features. Read CLAUDE.md first. Hard stop: we submit at 11:00 AM and
no pushes after 12:00 PM. If anything isn't passing by 10:20 AM, stop and tell me what's done.

If Phase 7 changes are still uncommitted, commit them first as their own commit
("Phase 7: water status modes, crew-note rows, readable date axis, regenerated replay runs").

A. Grounding: invented clock times
A live Jan 13 run (engineering + commander uploaded) produced a message_to_earth with
"approve ... by 08:00 tomorrow. Next update tomorrow at 19:00." The grounding check flagged 19
but passed 08:00, apparently because it tokenizes clock times into separate numbers (8 and 0
appear elsewhere in the data). The report also used the UI term "In projected mode".
1. Agent prompt: never state clock times, deadlines or schedules ("next update at…", "by 08:00")
   unless that exact time appears in tool results. No app/UI terms like "projected mode"; say
   "projected from the Jan 13 estimate".
2. grounding.ts: treat a clock time (HH:MM, optional am/pm: 19:00, 08:00, 12:35pm) as ONE value,
   grounded only if the same time appears in the tool results (normalize 12:35pm vs 12:35 so the
   real "12:35pm" quote still passes). Vitest cases: 19:00 and 08:00 ungrounded when absent;
   12:35pm grounded when present; plain numbers unchanged.
3. Re-run the grounding check over every saved data/demo/run-*.json WITHOUT regenerating them.
   Report per date. If any now fail, stop and tell me — do not edit or regenerate them.
4. Report (don't change) whether api/daily-report retries once on grounding failure like the CLI.

B. "Water on hand" chart looks empty
The chart has one point all mission (the Jan 13 crew estimate, ~360 L) because that is the only
volume estimate in the reports. The data is correct; the presentation reads as a bug. Also the
"~" label renders as a stray glyph above the point.
5. Replace the "Water on hand" chart with a compact row in the style of the "Crew notes only"
   rows: "Crew volume estimates: 1 · ~360 L on Jan 13" with the verified quote on hover/expand,
   plus "No later estimate — see the Water panel." When there are 0 estimates, the row says
   "No volume estimate reported yet." Use the same data the Water panel uses (analysis.water /
   the extracted readings) — no new calculation.
6. Do NOT plot projected or estimated values as if measured. Don't change water.ts math.
7. Update the QA check so this row exists on every day and no chart renders with ≤1 point
   (if it's simple; otherwise skip and tell me).

C. Finish
8. typecheck, test, lint, build; npm run qa (dev server running) at 1280 and 1920.
9. Add a README AI-log line; save this prompt in prompts/ like the other phases.
10. Commit and push to main. Then tell me the files changed and a 3-line summary I can explain.

Keep the diff small; I must be able to explain every line.
