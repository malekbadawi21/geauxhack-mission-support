// WaterPanel.tsx — the water panel: what the crew's water looks like on the as-of date.
//
// How it fits: renders analysis.water (water.ts's waterStatus()) beside the charts. Every number here
// comes from that object; this file only lays it out. The title always names the mode, so a judge can
// tell a projection from a measurement at a glance (Phase 7):
//   - projected:    "Projected from Jan 13 estimate · 1 day old". The big figure is the daily budget
//                   per person that reaches mission end; one bar per reference rate shows days left on a
//                   shared timeline that starts today, with mission end marked.
//   - since_refill: "Since Jan 17 refill · 4 days". No litres remaining (unknown): days since the refill,
//                   the static tank's measured trend, estimated water USED, and a callout asking for data.
//   - none:         says plainly that there is no volume estimate yet.
// Bars are plain HTML/CSS (widths in %), not SVG (competition rule: no custom SVG drawings).

import type { WaterNone, WaterProjected, WaterSinceRefill, WaterStatus } from "../lib/water.ts";
import { addDays } from "../lib/dates.ts";
import { FMARS_AVG_WATER_SOURCE, NASA_MIN_POTABLE_WATER_SOURCE } from "../lib/baselines.ts";
import { longDate, num, numRange, shortDate } from "../ui/format.ts";

/** "today" / "1 day" / "4 days": how long ago something was, for the panel title. */
const ago = (n: number, unit: string) => (n === 0 ? "today" : `${n} ${unit}${n === 1 ? "" : "s"}`);

/** Short source link names for the two reference rates. */
const SOURCE_NAME = { fmars_average: "FMARS study", nasa_minimum: "NASA-STD-3001 brief" };

// Where each rate comes from (baselines.ts). Shown in every mode, including "none", which has no rates.
const RATE_URLS = { fmars_average: FMARS_AVG_WATER_SOURCE, nasa_minimum: NASA_MIN_POTABLE_WATER_SOURCE };

/**
 * Draws the water panel for whichever mode water.ts chose.
 * @param water  analysis.water for the as-of date.
 */
export function WaterPanel({ water }: { water: WaterStatus }) {
  return (
    <section className="water panel" aria-labelledby="water-title">
      {water.mode === "projected" && <Projected w={water} />}
      {water.mode === "since_refill" && <SinceRefill w={water} />}
      {water.mode === "none" && <NoEstimate w={water} />}
      <ul className="water__notes">
        {water.notes.map((n) => (
          <li key={n}>{n}.</li>
        ))}
        <li>
          Rates:{" "}
          <a href={RATE_URLS.fmars_average} target="_blank" rel="noreferrer">
            {SOURCE_NAME.fmars_average}
          </a>
          ,{" "}
          <a href={RATE_URLS.nasa_minimum} target="_blank" rel="noreferrer">
            {SOURCE_NAME.nasa_minimum}
          </a>
          . Crew of {water.crew_size} ({water.crew_size_source}).
        </li>
      </ul>
    </section>
  );
}

/** The panel's heading: a small WATER label, the mode sentence, and a tag saying what kind of number this is. */
function Title({ text, sub, tag, tagClass }: { text: string; sub: string; tag: string; tagClass: string }) {
  return (
    <header className="water__head">
      <div className="fact__label">Water</div>
      <h3 id="water-title" className="water__title">
        {text} <span className="dim">· {sub}</span>
      </h3>
      <span className={`tag ${tagClass}`}>{tag}</span>
    </header>
  );
}

/** Projected mode: the estimate carried forward to today at each reference rate. */
function Projected({ w }: { w: WaterProjected }) {
  const e = w.estimate;
  const b = w.budget_to_mission_end;
  // Shared axis: today (0) to a little past the longest bar or mission end, at least 1 day long.
  const longest = Math.max(1, w.days_until_mission_end, ...w.scenarios.map((s) => s.days_left));
  const axisDays = Math.ceil(longest * 1.08);
  const pct = (days: number) => `${Math.min(100, (Math.max(0, days) / axisDays) * 100)}%`; // position on the axis as a CSS width
  // Tick every 5 days (every 2 when the axis is short) so labels never crowd; a tick too close to the
  // MISSION END label would print on top of it (Phase 6, Q5), so it is dropped.
  const step = axisDays > 14 ? 5 : 2;
  const ticks = Array.from({ length: Math.floor(axisDays / step) + 1 }, (_, i) => i * step).filter(
    (d) => w.days_until_mission_end <= 0 || Math.abs(d - w.days_until_mission_end) >= step / 2,
  );

  return (
    <>
      <Title
        text={`Projected from ${shortDate(e.reading_date)} estimate`}
        sub={e.days_since_estimate === 0 ? "estimate from today" : `${ago(e.days_since_estimate, "day")} old`}
        tag="PROJECTION, NOT A MEASUREMENT"
        tagClass="tag--muted"
      />

      <div className="water__values">
        <div className="fact fact--hero">
          <div className="fact__label">Daily budget to reach mission end</div>
          <div className="fact__value fact__value--xl mono">
            {b ? numRange(b.if_typical_so_far, b.if_minimal_so_far, 1) : "—"} <span className="fact__unit">L / person / day</span>
          </div>
          <div className="dim small">
            {b
              ? `Low end if use since ${shortDate(e.reading_date)} matched the FMARS average, high end if it matched the NASA minimum · ${w.days_until_mission_end} days to ${longDate(w.mission_end)}`
              : `Mission end (${longDate(w.mission_end)}) has been reached`}
          </div>
        </div>

        <div className="water__facts">
          <div className="fact">
            <div className="fact__label">Crew estimate · {shortDate(e.reading_date)}</div>
            <div className="fact__value mono">
              {e.approximate && "~"}
              {num(e.volume_l)} <span className="fact__unit">L</span>
            </div>
            <blockquote className="quote quote--compact">“{e.source_quote}”</blockquote>
          </div>
          <div className="fact">
            <div className="fact__label">Days since estimate</div>
            <div className="fact__value mono">{e.days_since_estimate}</div>
            <div className="dim small">Each day the projection subtracts crew × rate</div>
          </div>
        </div>

        <div className="bars" role="list">
          {w.scenarios.map((s) => {
            const bad = s.status !== "ok"; // empty, or runs out before mission end
            const tag = s.status === "projected_empty" ? "PROJECTED EMPTY" : s.status === "before_mission_end" ? "BEFORE MISSION END" : "PAST MISSION END";
            return (
              <div className="bar" role="listitem" key={s.id}>
                <div className="bar__label">
                  <span className="bar__name">{s.label}</span>
                  <span className="mono dim">{num(s.rate_l_per_person_day, 2)} L/person/day</span>
                </div>
                <div className="bar__track">
                  <div className={`bar__fill ${bad ? "bar__fill--critical" : "bar__fill--nominal"}`} style={{ width: pct(s.days_left) }} />
                  {w.days_until_mission_end > 0 && <div className="bar__end-line" style={{ left: pct(w.days_until_mission_end) }} aria-hidden="true" />}
                </div>
                <div className="bar__result">
                  <span className="mono bar__days">~{num(s.remaining_l, 0)} L left</span>
                  <span className="mono">{num(s.days_left)} days</span>
                  <span className="mono dim">runs out {shortDate(s.runs_out_on)}</span>
                  {/* Text label, not just color: the color repeats what this says. */}
                  <span className={`tag ${bad ? "tag--critical" : "tag--nominal"}`}>{tag}</span>
                </div>
              </div>
            );
          })}
          <div className="bars__axis" aria-hidden="true">
            {ticks.map((d) => (
              <span key={d} className="bars__tick mono" style={{ left: pct(d) }}>
                {d === 0 ? "TODAY" : shortDate(addDays(w.as_of, d))}
              </span>
            ))}
            {w.days_until_mission_end > 0 && (
              <span className="bars__end mono" style={{ left: pct(w.days_until_mission_end) }}>
                MISSION END {shortDate(w.mission_end).toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** Since-refill mode: what we know since the refill, and the estimate we still need. */
function SinceRefill({ w }: { w: WaterSinceRefill }) {
  const r = w.refill;
  const t = w.measured_trend;
  const e = w.last_estimate_before_refill;
  const maxUsed = Math.max(1, ...w.estimated_draw_since_refill.map((d) => d.used_l)); // the longest bar fills the track
  // A depth measured from the top grows as water is used, so its rate's sign reads the other way;
  // forecast.ts already gives the change in AMOUNT (negative = water going down).
  const trendWord = t ? (t.rate_per_day < 0 ? "dropping" : t.rate_per_day > 0 ? "rising" : "steady") : "";

  return (
    <>
      <Title text={`Since ${shortDate(r.date)} refill`} sub={ago(r.days_since_refill, "day")} tag="NO CURRENT VOLUME" tagClass="tag--warning" />

      {/* The missing-data line, as a callout: this is what Mission Support should ask the crew for. */}
      <div className="callout callout--warning" role="note">
        <strong>No volume estimate since the {shortDate(r.date)} refill</strong> — ask the crew for one. Until then, water on hand is unknown.
      </div>

      <div className="water__values">
        <div className="water__facts">
          <div className="fact">
            <div className="fact__label">Days since refill</div>
            <div className="fact__value mono">{r.days_since_refill}</div>
            {r.source_quote && <blockquote className="quote quote--compact">“{r.source_quote}”</blockquote>}
          </div>
          <div className="fact">
            <div className="fact__label">Measured tank trend</div>
            {t ? (
              <>
                <div className="fact__value fact__value--md mono">
                  {trendWord} {t.rate_per_day !== 0 && `~${num(Math.abs(t.rate_per_day))}`} <span className="fact__unit">{t.unit}/day</span>
                </div>
                <div className="dim small">
                  Static tank, {t.measured_from ? `from-${t.measured_from} ` : ""}readings {shortDate(t.from_date)} → {shortDate(t.to_date)} ({t.points_used} readings)
                </div>
              </>
            ) : (
              <>
                <div className="fact__value mono dim">—</div>
                {/* water.ts writes ISO dates (for the agent); shown here as "Jan 17". Regex: any YYYY-MM-DD. */}
                <div className="dim small">{w.measured_trend_reason?.replace(/\d{4}-\d{2}-\d{2}/g, shortDate)}</div>
              </>
            )}
          </div>
        </div>

        <div className="bars" role="list">
          <div className="fact__label">Estimated water used since the refill — not water remaining</div>
          {w.estimated_draw_since_refill.map((d) => (
            <div className="bar" role="listitem" key={d.id}>
              <div className="bar__label">
                <span className="bar__name">{d.label}</span>
                <span className="mono dim">{num(d.rate_l_per_person_day, 2)} L/person/day</span>
              </div>
              <div className="bar__track">
                <div className="bar__fill bar__fill--draw" style={{ width: `${(d.used_l / maxUsed) * 100}%` }} />
              </div>
              <div className="bar__result">
                <span className="mono bar__days">~{num(d.used_l, 0)} L used</span>
                <span className="mono dim">
                  {w.crew_size} crew × {num(d.rate_l_per_person_day, 2)} L × {r.days_since_refill} days
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="dim small">
          Last estimate: {e.approximate && "~"}
          {num(e.volume_l)} L on {shortDate(e.reading_date)} — predates the refill, not current.
        </div>
      </div>
    </>
  );
}

/** None mode: no volume estimate yet. */
function NoEstimate({ w }: { w: WaterNone }) {
  return (
    <>
      <Title text="No volume estimate yet" sub={`as of ${shortDate(w.as_of)}`} tag="UNAVAILABLE" tagClass="tag--muted" />
      <p className="water__reason">{w.reason}. Days-of-water can't be computed without one.</p>
      <p className="dim small">Mission end {longDate(w.mission_end)}.</p>
    </>
  );
}
