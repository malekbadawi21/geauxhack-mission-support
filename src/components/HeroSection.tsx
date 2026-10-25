// HeroSection.tsx — the largest part of the page: usage charts per resource plus the water panel.
//
// How it fits: lays out one UsageChart per resource in analysis.series (headline resources first)
// and the WaterScenarios panel. On wide screens the water panel sits in its own column beside the
// charts; below ~1600px it moves under them (see .hero in app.css).

import type { Analysis } from "../lib/analyze.ts";
import type { Resource } from "../lib/schema.ts";
import { RESOURCE_ORDER } from "../ui/format.ts";
import { UsageChart } from "./UsageChart.tsx";
import { WaterScenarios } from "./WaterScenarios.tsx";

/**
 * Renders the hero section.
 * @param startDate  First report day loaded (left edge of every chart).
 */
export function HeroSection({ analysis, startDate }: { analysis: Analysis; startDate: string }) {
  /** Position of a resource in RESOURCE_ORDER; anything not listed goes last. */
  const rank = (r: Resource) => {
    const i = RESOURCE_ORDER.indexOf(r);
    return i === -1 ? RESOURCE_ORDER.length : i;
  };
  const series = [...analysis.series].sort((a, b) => rank(a.resource) - rank(b.resource));
  // Charts end at mission end, or at the as-of date if that is later.
  const endDate = analysis.asOf > analysis.crew.mission_end ? analysis.asOf : analysis.crew.mission_end;

  return (
    <section className="section hero" aria-labelledby="hero-title">
      <div className="section__head">
        <h2 id="hero-title">Consumables</h2>
        <p className="section__sub">
          One point per report day up to the as-of date. Gaps are missing data, never filled in. Hover a day for what the crew
          wrote.
        </p>
      </div>
      <div className="hero__grid">
        <div className="hero__charts">
          {series.length === 0 && <p className="panel empty">No readings on or before this date.</p>}
          {series.map((s) => (
            <UsageChart
              key={s.resource}
              series={s}
              forecast={analysis.forecasts.find((f) => f.resource === s.resource)}
              startDate={startDate}
              endDate={endDate}
              asOf={analysis.asOf}
            />
          ))}
        </div>
        <div className="hero__water">
          <WaterScenarios value={analysis.waterScenarios} reason={analysis.waterScenariosReason} crew={analysis.crew} />
        </div>
      </div>
    </section>
  );
}
