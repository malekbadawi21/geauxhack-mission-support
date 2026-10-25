// ResourceCards.tsx — one card per headline resource: latest value, trend, and days to empty.
//
// How it fits: reads analysis.series (for the latest reading of each resource) and
// analysis.forecasts (for the rate and days-to-empty). When the forecast can't give a countdown, the
// card shows forecast.reason in plain words instead of a number (CLAUDE.md: missing stays missing).
// "Water on hand" uses water.ts's latestWaterVolume(), the same staleness rule as the water scenarios:
// a volume stated before a refill is dimmed and labeled STALE, never shown as current (Phase 6, K2).

import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import type { Analysis } from "../lib/analyze.ts";
import type { Resource } from "../lib/schema.ts";
import { latestWaterVolume } from "../lib/water.ts";
import { RESOURCE_LABEL, num, pointValueText, shortDate, unitText } from "../ui/format.ts";

// The four resources the crew and Earth care about most (prompts/phase-4.md).
const CARDS: Resource[] = ["diesel", "propane", "water_static", "water_total"];

/** Renders the row of resource cards for the current analysis. */
export function ResourceCards({ analysis }: { analysis: Analysis }) {
  return (
    <section className="cards" aria-label="Resources">
      {CARDS.map((r) => (
        <ResourceCard key={r} resource={r} analysis={analysis} />
      ))}
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
  // Water on hand only: the date of a refill after the volume was stated (null = still current).
  const refilledOn = resource === "water_total" ? latestWaterVolume(analysis.series, analysis.asOf).refilled_on : null;

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
      <div className={`card__value mono ${refilledOn ? "card__value--stale" : ""}`}>{value ?? <span className="dim">No reading</span>}</div>
      {refilledOn && <span className="tag tag--warning card__stale">STALE — predates the {shortDate(refilledOn)} refill</span>}
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
        {refilledOn ? (
          <span className="small dim">No current volume estimate: the crew hasn't stated one since the refill.</span>
        ) : forecast?.days_to_empty != null ? (
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
          <span className="small dim">
            No countdown: {forecast?.reason ?? "no readings yet"}
            {resource === "water_total" && analysis.waterScenarios && " — see water scenarios"}.
          </span>
        )}
      </div>
    </article>
  );
}
