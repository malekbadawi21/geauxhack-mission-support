Read CLAUDE.md first and follow it. This is Phase 7: water panel redesign + chart cleanup. Runs LOCALLY.
Hard stop: if this isn't working by ~1:30 AM, Malek will revert to the pre-phase-7 commit. Keep changes tight.

## 1. Remove empty charts (UI)
- Any resource with zero numeric readings across the whole mission (currently loft and trailer tanks)
  gets no chart. Instead, under the charts, show one compact "Crew notes only" row per such resource:
  resource name + its dated note pills (same pill styles as now; tooltip keeps the quote).
- Charts that do have numbers keep their crew-notes row as now.

## 2. Fix colliding x-axis labels (UI)
- Date ticks must never overlap ("Jan 12Jan 13…"). Use short day labels ("12", "13", …) with the month
  shown once, and thin ticks automatically at narrow widths. Check at 1280 and 1920 widths.

## 3. Water panel: project forward from the estimate (src/lib/water.ts + UI)
Replace the current waterScenarios output with a `waterStatus(…, asOf, crew)` that has two modes.
Rates still come from baselines.ts; crew size from CREW_147. Never invent a volume.

Mode "projected" — a volume estimate exists on/before asOf and no refill happened after it:
- estimate: { volume_l, approximate, reading_date, source_quote, days_since_estimate }
- for each scenario (FMARS average 12.12, NASA minimum 2.5 L/person/day):
  used_l = crew × rate × days_since_estimate
  remaining_l = max(0, volume − used_l)
  days_left = remaining_l / (crew × rate)
  runs_out_on = reading_date + volume / (crew × rate) days (unchanged by asOf)
  status: "ok" | "before_mission_end" | "projected_empty" (when remaining_l is 0)
- budget_to_mission_end: { if_typical_so_far, if_minimal_so_far } in L/person/day =
  remaining_l for that scenario / (crew × days until mission end); null if mission end ≤ asOf.
- notes: "Projection from one crew estimate, not a measurement"; "Estimate is N days old";
  plus the existing FMARS/NASA caveats.

Mode "since_refill" — a refill happened after the latest volume estimate:
- refill: { date, source_quote, days_since_refill }
- measured_trend: the static tank's own forecast rate since the refill if it has ≥2 comparable numeric
  readings (e.g. "level dropping ~5 cm/day, from-top readings"), else null with reason.
- estimated_draw_since_refill: for each scenario, crew × rate × days_since_refill (L) — labeled as an
  estimate of water USED, not water remaining.
- missing: "No volume estimate since the <date> refill — ask the crew for one."
- remaining is NOT computed.

Mode "none" — no volume estimate at all yet: say so plainly.

UI: the panel shows the mode clearly in its title ("Projected from Jan 13 estimate · 1 day old" /
"Since Jan 17 refill · 4 days"). Projected mode: remaining litres and days left per scenario (bars on the
shared timeline with mission end marked), the budget range as the big figure. Since-refill mode: days
since refill, measured tank trend, estimated draw bars, and the missing-data line as a callout.
"Water on hand" card follows the same mode (projected value marked "projected", or stale + since-refill).

## 4. Agent + reports
- The agent's get_water_scenarios tool returns the new waterStatus output (rename the tool to
  get_water_status). Update its description so the agent explains projections as projections and, in
  since_refill mode, includes asking the crew for a volume estimate (in crew_actions or
  decisions_for_earth, within the 3-decision cap).
- Update tests: projection math per day, runs_out_on stable across days, remaining clamps at 0,
  since_refill mode after Jan 17, budget null after mission end.
- Re-run `npm run build-demo`, then regenerate ALL replay runs:
  `npm run daily-report -- crew-147 --all --force`. Same rules as Phase 6 Part C (one retry per failing
  date, never hand-edit). Print the per-date table.

## Rules
- Competition rule: no custom SVG drawings — Recharts, lucide-react, CSS only.
- Don't change the API shapes beyond the renamed water tool's output.

## Done when
- Jan 14, 15, 16 show different water numbers each day; Jan 18+ shows since-refill mode with real data.
- No empty charts; no overlapping date labels at 1280 or 1920.
- `npm run qa` (start the dev server first) passes with 0 problems; add a check that the water panel
  values differ between Jan 14 and Jan 15.
- Type check, build, tests, lint, vercel build pass. Every run has 0 ungrounded numbers or is listed.
- README AI log + Current state updated. Stop and summarize with the per-date table. Don't commit.
