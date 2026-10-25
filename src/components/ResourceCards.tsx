// ResourceCards.tsx — one card per headline resource: latest value, trend, and days to empty.
//
// How it fits: reads analysis.series (for the latest reading of each resource) and
// analysis.forecasts (for the rate and days-to-empty). When the forecast can't give a countdown, the
// card shows forecast.reason in plain words instead of a number (CLAUDE.md: missing stays missing).
// "Water on hand" is its own card (WaterCard below) that reads analysis.water, the same object as the
// water panel, so the two always agree (Phase 7): a projected value is marked PROJECTED; after a refill
// the old estimate is dimmed and labeled STALE, never shown as current (Phase 6, K2).

import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import type { Analysis } from "../lib/analyze.ts";
import type { Resource } from "../lib/schema.ts";
import { RESOURCE_LABEL, num, numRange, pointValueText, shortDate, unitText } from "../ui/format.ts";

// The four resources the crew and Earth care about most (prompts/phase-4.md).
const CARDS: Resource[] = ["diesel", "propane", "water_static", "water_total"];

/** Renders the row of resource cards for the current analysis. */
export function ResourceCards({ analysis }: { analysis: Analysis }) {
  return (
    <section className="cards" aria-label="Resources">
      {CARDS.map((r) => (r === "water_total" ? <WaterCard key={r} analysis={analysis} /> : <ResourceCard key={r} resource={r} analysis={analysis} />))}
    </section>
  );
}

/**
 * One card.
 * Latest value = the most recent series point with a number or a state word (so "FULL" can show).
 * Trend = the sign of the forecast's rate; with no rate there is no arrow, just "no trend".
 */
function ResourceCard({ resource, analysis }: { resource: Resource; analysis: Analysis }) {
  const series = analysis.series.find((s) => s.resource === resource);
  const forecast = analysis.forecasts.find((f) => f.resource === resource);
  // findLast = the last point that passes the test (newest, since points are oldest first).
  const latest = series?.points.findLast((p) => p.value !== null || p.status !== null);
  const value = latest ? pointValueText(latest) : null;
  const rate = forecast?.rate_per_day ?? null;
  const stale = latest && latest.date !== analysis.latestReportDate; // value is from an earlier day

  // Trend arrow plus a text label, so the trend is never shown by icon or color alone.
  const trend =
    rate === null
      ? { icon: <Minus size={16} />, text: "no trend", cls: "dim" }
      : rate < 0
        ? { icon: <ArrowDownRight size={16} />, text: `falling ${num(rate)} ${unitText(forecast!.latest!.unit)}/day`, cls: "trend--down" }
        : rate > 0
          ? { icon: <ArrowUpRight size={16} />, text: `rising +${num(rate)} ${unitText(forecast!.latest!.unit)}/day`, cls: "trend--up" }
          : { icon: <ArrowRight size={16} />, text: "steady", cls: "dim" };

  return (
    <article className="card panel">
      <header className="card__head">
        <h3>{RESOURCE_LABEL[resource]}</h3>
        {latest && <span className="mono dim small">{latest.report_kind}</span>}
      </header>
      <div className="card__value mono">{value ?? <span className="dim">No reading</span>}</div>
      <div className="card__meta small">
        {latest ? (
          <span className={stale ? "warn-text" : "dim"}>
            {stale ? "last reported " : "reported "}
            {shortDate(latest.date)} · “{latest.raw_text}”
          </span>
        ) : (
          <span className="dim">Not reported on or before {shortDate(analysis.asOf)}</span>
        )}
      </div>
      <div className={`card__trend small ${trend.cls}`}>
        {trend.icon}
        <span>{trend.text}</span>
      </div>
      <div className="card__countdown">
        {forecast?.days_to_empty != null ? (
          <>
            <span className="card__days mono">~{num(forecast.days_to_empty)}</span>
            <span className="small">
              days to empty
              <br />
              <span className="dim">
                from {shortDate(forecast.latest!.date)}, {forecast.points_used} readings
              </span>
            </span>
          </>
        ) : (
          <span className="small dim">No countdown: {forecast?.reason ?? "no readings yet"}.</span>
        )}
      </div>
    </article>
  );
}

/**
 * The "Water on hand" card, in the water panel's mode (analysis.water):
 *   projected    → litres left as a range over the two reference rates, tagged PROJECTED (or CREW
 *                  ESTIMATE on the day it was stated, when nothing has been subtracted yet);
 *   since_refill → the old estimate struck through and tagged STALE, plus what's missing;
 *   none         → "No reading".
 */
function WaterCard({ analysis }: { analysis: Analysis }) {
  const w = analysis.water;
  return (
    <article className="card panel">
      <header className="card__head">
        <h3>{RESOURCE_LABEL.water_total}</h3>
        {w.mode !== "none" && <span className="mono dim small">{w.mode === "projected" ? "projected" : "since refill"}</span>}
      </header>
      {w.mode === "none" && (
        <>
          <div className="card__value mono">
            <span className="dim">No reading</span>
          </div>
          <div className="card__meta small dim">No volume estimate on or before {shortDate(analysis.asOf)}</div>
          <div className="card__countdown">
            <span className="small dim">No countdown: the crew hasn't stated a total volume yet.</span>
          </div>
        </>
      )}
      {w.mode === "projected" && (
        <>
          <div className="card__value mono">
            ~{numRange(w.scenarios[0].remaining_l, w.scenarios[1].remaining_l, 0)} <span className="fact__unit">L</span>
          </div>
          <span className={`tag card__tag ${w.estimate.days_since_estimate === 0 ? "tag--muted" : "tag--warning"}`}>
            {w.estimate.days_since_estimate === 0 ? "CREW ESTIMATE" : `PROJECTED · ${w.estimate.days_since_estimate} DAY${w.estimate.days_since_estimate === 1 ? "" : "S"} AFTER ESTIMATE`}
          </span>
          <div className="card__meta small dim">
            from {w.estimate.approximate && "~"}
            {num(w.estimate.volume_l)} L on {shortDate(w.estimate.reading_date)} · “{w.estimate.source_quote}”
          </div>
          <div className="card__countdown">
            <span className="card__days card__days--range mono">~{numRange(w.scenarios[0].days_left, w.scenarios[1].days_left)}</span>
            <span className="small">
              days left (projected)
              <br />
              <span className="dim">at FMARS-average → NASA-minimum use</span>
            </span>
          </div>
        </>
      )}
      {w.mode === "since_refill" && (
        <>
          <div className="card__value mono card__value--stale">
            {w.last_estimate_before_refill.approximate && "~"}
            {num(w.last_estimate_before_refill.volume_l)} L
          </div>
          <span className="tag tag--warning card__stale">STALE — predates the {shortDate(w.refill.date)} refill</span>
          <div className="card__meta small dim">
            estimate from {shortDate(w.last_estimate_before_refill.reading_date)} · since refill {w.refill.days_since_refill} day
            {w.refill.days_since_refill === 1 ? "" : "s"}
          </div>
          <div className="card__countdown">
            <span className="small dim">No volume estimate since the {shortDate(w.refill.date)} refill — ask the crew for one.</span>
          </div>
        </>
      )}
    </article>
  );
}
