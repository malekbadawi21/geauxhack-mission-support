// WaterScenarios.tsx — "how long would the water last?" for the as-of date.
//
// How it fits: renders analysis.waterScenarios (computed by src/lib/water.ts) next to the charts.
// Every number here comes from that object; this file only lays it out. The bars share one day axis
// that starts on the day the volume was stated, with the mission-end date marked, so a judge can see
// at a glance which scenario runs out before the crew goes home. When the analysis has no usable
// volume, the reason from water.ts is shown instead of a number.

import type { WaterScenarios as Scenarios } from "../lib/analyze.ts";
import type { CrewConfig } from "../lib/constants.ts";
import { addDays } from "../lib/dates.ts";
import { longDate, num, shortDate } from "../ui/format.ts";

type Props = { value: Scenarios | null; reason: string | null; crew: CrewConfig };

/**
 * Draws the water panel.
 * @param value   analysis.waterScenarios (null when not available)
 * @param reason  analysis.waterScenariosReason (why it is null)
 */
export function WaterScenarios({ value, reason, crew }: Props) {
  if (!value) {
    return (
      <section className="water panel" aria-labelledby="water-title">
        <h3 id="water-title" className="water__title">
          Water scenarios
        </h3>
        <div className="water__unavailable">
          <span className="tag tag--muted">UNAVAILABLE</span>
          {/* The reason is water.ts's own sentence, capitalized for display. */}
          <p className="water__reason">{reason ? reason[0].toUpperCase() + reason.slice(1) : "No water volume available"}.</p>
          <p className="dim small">
            Scenarios need a total water volume stated by the crew, with no refill since. Mission end {longDate(crew.mission_end)}.
          </p>
        </div>
      </section>
    );
  }

  // Shared axis: from the reading day (0) to a little past the longest bar or mission end.
  const longest = Math.max(value.days_until_mission_end, ...value.scenarios.map((s) => s.days_left));
  const axisDays = Math.ceil(longest * 1.08);
  const pct = (days: number) => `${Math.min(100, (days / axisDays) * 100)}%`; // position on the axis as a CSS width
  // Tick every 5 days (every 2 when the axis is short) so labels never crowd.
  const step = axisDays > 14 ? 5 : 2;
  const ticks = Array.from({ length: Math.floor(axisDays / step) + 1 }, (_, i) => i * step);
  const required = value.required_rate_to_mission_end_l_per_person_day;

  return (
    <section className="water panel" aria-labelledby="water-title">
      <h3 id="water-title" className="water__title">
        Water scenarios <span className="dim">· from {longDate(value.reading_date)}</span>
      </h3>

      <div className="water__facts">
        <div className="fact">
          <div className="fact__label">Water on hand</div>
          <div className="fact__value mono">
            {value.approximate && "~"}
            {num(value.volume_l)} <span className="fact__unit">L</span>
          </div>
          <blockquote className="quote quote--compact">“{value.source_quote}”</blockquote>
          {value.approximate && <div className="dim small">Crew estimate (approximate)</div>}
        </div>
        <div className="fact">
          <div className="fact__label">Crew size</div>
          <div className="fact__value mono">{value.crew_size}</div>
          <div className="dim small">{value.crew_size_source}</div>
        </div>
        <div className="fact fact--hero">
          <div className="fact__label">Needed to reach mission end</div>
          <div className="fact__value fact__value--xl mono">
            {required === null ? "—" : num(required, 2)} <span className="fact__unit">L / person / day</span>
          </div>
          <div className="dim small">
            {value.days_until_mission_end} days to {longDate(crew.mission_end)} ({crew.mission_end_source})
          </div>
        </div>
      </div>

      {/* The bar chart is plain HTML: each bar's width is its share of the shared day axis. */}
      <div className="bars" role="list">
        {value.scenarios.map((s) => {
          const short = s.days_left < value.days_until_mission_end; // runs out before mission end
          return (
            <div className="bar" role="listitem" key={s.id}>
              <div className="bar__label">
                <span className="bar__name">{s.label}</span>
                <span className="mono dim">{num(s.rate_l_per_person_day, 2)} L/person/day</span>
              </div>
              <div className="bar__track">
                <div className={`bar__fill ${short ? "bar__fill--critical" : "bar__fill--nominal"}`} style={{ width: pct(s.days_left) }} />
                <div className="bar__end-line" style={{ left: pct(value.days_until_mission_end) }} aria-hidden="true" />
              </div>
              <div className="bar__result">
                <span className="mono bar__days">{num(s.days_left)} days</span>
                <span className="mono">runs out {shortDate(s.runs_out_on)}</span>
                {/* Text label, not just color: the color repeats what this says. */}
                <span className={`tag ${short ? "tag--critical" : "tag--nominal"}`}>{short ? "BEFORE MISSION END" : "PAST MISSION END"}</span>
              </div>
            </div>
          );
        })}
        <div className="bars__axis" aria-hidden="true">
          {ticks.map((d) => (
            <span key={d} className="bars__tick mono" style={{ left: pct(d) }}>
              {shortDate(addDays(value.reading_date, d))}
            </span>
          ))}
          <span className="bars__end mono" style={{ left: pct(value.days_until_mission_end) }}>
            MISSION END {shortDate(crew.mission_end).toUpperCase()}
          </span>
        </div>
      </div>

      <ul className="water__notes">
        {value.notes.map((n) => (
          <li key={n}>{n}.</li>
        ))}
        <li>
          Sources:{" "}
          {value.scenarios.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <a href={s.source_url} target="_blank" rel="noreferrer">
                {s.id === "fmars_average" ? "FMARS study" : "NASA-STD-3001 brief"}
              </a>
            </span>
          ))}
          .
        </li>
      </ul>
    </section>
  );
}
