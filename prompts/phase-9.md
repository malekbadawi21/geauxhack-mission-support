New small features, explicitly approved by Malek — build them on a BRANCH, not main.
Read CLAUDE.md first. Hard stop: if it isn't passing by 11:10 AM, stop and tell me what's done.
Do Part A first and commit it before starting Part B, so A can ship alone if B runs out of time.

0. Setup: confirm the working tree is clean and main is up to date (git status, git pull).
   If anything is uncommitted, stop and tell me. Then: git switch -c critical-alert

PART A — Critical alert the crew must acknowledge
Critical flags are easy to miss. When processing finishes, any CRITICAL flag for that day must
appear in a pop-up the crew has to acknowledge.
1. When: when a report finishes processing (an upload completing in Replay or Live — the moment
   "Daily report ready" is reached), if that day's analysis has ≥1 flag with severity "critical".
   Do NOT show it when the user just clicks a day tab. Don't show a flag again once acknowledged
   (acknowledged flag ids in React state for the session; no new storage).
2. Content — only data that already exists; no new calculations, no AI-generated labels:
   - Title "Critical alert — Jan 13, 2015" (the as-of date) with a lucide-react AlertTriangle.
   - One block per critical flag: title + summary exactly as the Flags table shows them, and its
     verified source quote(s) with which report each came from (engineering/commander).
   - Severity from flags.ts rules only, never Gemini's labels.
   - One button: "Acknowledge". No close X; clicking the backdrop does nothing.
3. After acknowledging: dialog closes; that flag's row in the Flags table shows a small
   "Acknowledged" tag. Nothing else changes.
4. Accessibility: role="dialog", aria-modal="true", aria-labelledby the title; focus moves to
   Acknowledge on open and returns afterwards; Escape does NOT dismiss; Tab stays inside.
   Critical styling also says "Critical" in text, not color alone.
5. One new component (e.g. src/ui/CriticalAlertDialog.tsx) + minimal wiring. Existing CSS
   variables; no new dependencies; no images or custom SVG drawings.
6. Tests: vitest for "which flags go in the dialog" (critical only; acknowledged excluded).
   QA: existing checks still pass (acknowledge the dialog where it appears); new checks — appears
   after the Jan 13 Replay upload, lists the trailer-tank flag with its quote, does not appear on
   clicking the Jan 14 tab, Acknowledge closes it and adds the tag.
7. Run typecheck/test/lint/build/qa, then COMMIT Part A.

PART B — Make the UI feel alive (CSS only)
Subtle, quick motion — this is a mission tool, not a game. Use CSS transitions/keyframes in the
existing stylesheet(s). No new dependencies, no JS animation libraries, no count-up numbers
(QA reads the values), no layout-shifting animation (transform and opacity only).
8. Hover lift on interactive blocks: the four stat cards (Diesel, Propane, Static water tank,
   Water on hand), chart cards, and daily-report sections — on hover, transform:
   translateY(-2px) scale(1.015), slightly stronger border/shadow, transition ~160ms ease-out.
   Make sure the scaled card never overlaps its neighbour (grid gap must exceed the growth).
   Add the same on :focus-visible for keyboard users where the element is focusable.
9. Flag rows: hover background highlight; the expand chevron rotates 90° smoothly when a row
   opens; the expanded quotes fade/slide in (~180ms).
10. Day tabs and the Replay/Live toggle: hover/active background transition (~120ms); the
    selected tab change animates its background, not its size.
11. Day change: when switching days, the main content fades in (opacity 0→1 + translateY 4px→0,
    ~200ms). Recharts: if line animation is currently off, enable a short one (~400ms) on day
    change only if it doesn't break QA; otherwise leave it off and tell me.
12. Processing panel: the step that's currently running gets a gentle pulsing dot; completed
    steps' check icons pop in (scale 0.8→1, ~150ms).
13. Critical emphasis: the critical-alert dialog enters with backdrop fade + panel scale
    0.96→1 (~180ms). The red "N critical" count badge pulses once (not looping) when a day with
    critical flags loads.
14. Respect accessibility: wrap all of Part B motion in @media (prefers-reduced-motion:
    no-preference) so it's fully disabled for users who ask for reduced motion. Run QA with
    reduced motion emulated (Playwright reducedMotion: 'reduce') so measurements aren't taken
    mid-animation, and keep all existing QA checks passing at 1280 and 1920.

FINISH
15. typecheck, test, lint, build, npm run qa (dev server running). Add a README AI-log line and
    save this prompt in prompts/ like the other phases. Commit Part B separately.
16. Push the branch (git push -u origin critical-alert). Do NOT merge into main. Tell me the files
    changed, which parts landed, and a 3-line summary of each part I can explain.

Keep the diff small; I must be able to explain every line.
