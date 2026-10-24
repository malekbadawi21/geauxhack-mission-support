Read CLAUDE.md first and follow it. This is Phase 4: the dashboard UI. You are running in a CLOUD session:
there is no .env and no Gemini key, so never call Gemini or the API to test. Phase 3b (agent + API) is
being built in parallel in another session.

## File ownership (do not cross)
- You own: src/App.tsx, src/main.tsx, src/components/**, src/ui/**, src/styles/**, index.html
  (title/meta/favicon only), and adding UI dependencies to package.json.
- Do NOT edit: api/**, src/lib/** (import from it only), scripts/**, data/**, README.md, CLAUDE.md.
- Write your AI-assisted file log to docs/ai-log-phase-4.md (Malek merges it into the README).
- Work on a branch named phase-4-ui, push it, and open a pull request. Don't merge.

## Data the UI uses (all already in the repo)
- Saved extractions: data/extractions/2015-*.json (load with import.meta.glob, eager).
- Demo setup: data/demo/manifest.json.
- Pre-computed analyses: data/demo/analysis-2015-01-12.json, analysis-2015-01-13.json.
- Replay run: data/demo/run-2015-01-13.json (a DemoRun; may be a sample now, a real run later — same shape).
- Types: Analysis (src/lib/analyze.ts), DailyReport / AgentTraceStep / DemoRun (src/lib/report-types.ts).
- Live computation: call analyzeCrew(extractions, asOf) in the browser whenever the as-of day changes.

## Modes
- REPLAY (default): loads history through manifest.preload_through. The user uploads the Jan 13 files
  (drag-drop or a button that "selects" the two demo files). The UI recognizes them by filename, uses the
  saved extractions and run-2015-01-13.json, and plays the pipeline stages with realistic timing:
  Reading reports → Verifying quotes → Updating analysis → Agent investigating (trace steps appear one by
  one) → Daily report ready.
- LIVE: same flow, but POST each file's text to /api/extract, then POST { extractions, as_of } to
  /api/daily-report (shapes in prompts/phase-3b.md). On any error, show it plainly and offer
  "Switch to replay".
- A visible mode badge: "Replay — recorded run" or "Live". Never present replay as live.

## Screen (Malek's choices: dark ops console, scrolling sections, charts + water scenarios are the hero)
Desktop-first, single scrolling page made of clear full-width sections; must look great on a
1920×1080 projector and stay usable at 1280 wide. Keep a compact sticky header so the as-of date and
mode stay visible while scrolling.
1. Header (sticky): product name (one constant, placeholder "Mission Support"), crew name, as-of date,
   mode toggle, Upload button.
2. Day scrubber: the report dates as a compact segmented row; clicking a past day recomputes everything
   with analyzeCrew for that as-of date (no look-ahead).
3. Status strip: overall status from the daily report (or "No report yet"), critical/warning counts.
4. Resource cards (diesel, propane, static tank, water total): latest value with unit, "~" for
   approximate, trend arrow, days-to-empty — or the reason there is no countdown, shown in plain text.
5. HERO SECTION — the largest, most polished part of the page:
   a. Usage charts (Recharts): large line charts per resource over the report days (at least 2 per row
      on wide screens); refill markers; a vertical as-of marker; gaps for missing values; units on
      axes; "status" readings (empty/full) as labeled dots; hover tooltips showing the raw_text and quote.
   b. Water scenarios panel beside or directly under the charts, visually prominent: volume (~ if
      approximate) with its quote, crew size with its source, a horizontal bar per scenario (days left,
      runs-out date) on a shared day axis with the mission-end date marked, the required L/person/day to
      mission end as a large figure, and the notes in small text. If null, show the reason.
7. Flags list: sorted by severity; each row expands to show evidence quotes as styled quotations with a
   "verified in report" check and the report kind (engineering/commander). Unverified items are marked.
8. Daily report panel: status line, concerns (each links to its flag rows), crew actions, decisions for
   Earth, and the message to Earth styled as an outgoing transmission with a note about the ~20-minute
   one-way delay. A grounding badge: "All N numbers traced to source data" or the ungrounded ones highlighted.
9. Agent trace: a vertical timeline of tool calls with short summaries and timings.

## Design direction
- Real operations console, not a sci-fi toy: dark slate background, high-contrast text, one restrained
  accent; amber = warning, red = critical, green/teal = nominal. Color is never the only signal (always a
  text label too).
- Typography: IBM Plex Sans for UI and IBM Plex Mono for data, installed via @fontsource packages
  (no Google Fonts CDN or any other network font loading). Tabular numbers for all figures.
- Dense but calm: clear grid, generous gutters, consistent 8px spacing, subtle 1px borders, no gradients,
  no glassmorphism, no emoji, no stock illustration. No images at all except hand-written inline SVG.
- Icons: lucide-react is allowed (ISC license — note it in docs/ai-log-phase-4.md) or hand-written SVG.
- Motion only for pipeline stages and trace steps appearing; respect prefers-reduced-motion.
- Write CSS yourself (CSS modules or one stylesheet with CSS variables). No UI kit.

## Done when
- `npm run build` and the type check pass.
- Replay mode works end to end from the Jan 12 state through the Jan 13 upload to the daily report.
- The day scrubber recomputes correctly (e.g. Jan 18 shows water scenarios unavailable with the reason).
- PR opened from phase-4-ui with a description listing components, how to run, and anything that
  depends on Phase 3b. Stop.
