# AI-assisted code — Phase 4 (dashboard UI)

Files written or edited with Claude Code (Claude Opus 5.5). Malek: merge these into the README's
"AI-assisted code" section.

- `src/App.tsx` — replaced the placeholder with the dashboard root: app state, `analyzeCrew(received, asOf, CREW_147)` on every day/data change, and the Replay/Live upload pipeline runner.
- `src/main.tsx` — loads the IBM Plex fonts (@fontsource) and `src/styles/app.css`; comments added.
- `src/styles/app.css` — new: the whole stylesheet (dark ops-console palette as CSS variables, layout, reduced-motion rule). Replaces the template's `src/index.css` (deleted).
- `src/ui/config.ts` — new: product name constant and replay pacing.
- `src/ui/data.ts` — new: bundles saved extractions, the demo manifest and recorded runs with `import.meta.glob`, validated with the zod schemas; lazy report texts for Live mode.
- `src/ui/format.ts` — new: resource labels, number/date/value formatting, quote-verification lookup, flag anchor ids.
- `src/ui/pipeline.ts` — new: pipeline stage types and the Live calls to `/api/extract` and `/api/daily-report`, with response validation.
- `src/components/Header.tsx` — new: sticky header (product, crew, as-of date, mode toggle + badge, Upload) and the day scrubber.
- `src/components/UploadPanel.tsx` — new: upload dialog (drag-drop, file picker, "Use demo files").
- `src/components/PipelinePanel.tsx` — new: stage stepper, per-file notes, trace steps appearing, Live error with "Switch to replay".
- `src/components/StatusStrip.tsx` — new: overall status from the daily report and flag counts.
- `src/components/ResourceCards.tsx` — new: latest value, trend, days to empty or the reason there is none.
- `src/components/HeroSection.tsx` — new: charts grid + water panel layout.
- `src/components/UsageChart.tsx` — new: Recharts line chart per resource (gaps, refill / as-of / mission-end markers, state-word markers, hover tooltip with raw text and quote).
- `src/components/WaterScenarios.tsx` — new: water volume, crew size, scenario bars on a shared day axis, required L/person/day.
- `src/components/FlagsList.tsx` — new: expandable flag rows with evidence quotes.
- `src/components/Quote.tsx` — new: a quotation with its verified / not-verified mark and report kind.
- `src/components/DailyReportPanel.tsx` — new: concerns (linked to flags), crew actions, decisions for Earth, message to Earth as a transmission, grounding badge with ungrounded numbers highlighted.
- `src/components/AgentTrace.tsx` — new: vertical timeline of agent tool calls.
- `index.html` — title set to the product name; description and theme-color meta tags.
- `package.json` — added UI dependencies (below).

## Dependencies added
- `recharts` (MIT) — charts. `react-is` (MIT) — Recharts peer dependency; needed explicitly because `.npmrc` sets `legacy-peer-deps`.
- `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` (fonts under SIL Open Font License 1.1) — fonts bundled with the app, no font CDN.
- `lucide-react` (ISC license) — icons.

None of these call a remote service.
