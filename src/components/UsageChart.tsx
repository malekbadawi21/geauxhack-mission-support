// UsageChart.tsx — one resource's level over the mission, drawn with Recharts.
//
// How it fits: HeroSection renders one of these per resource in analysis.series. The x-axis runs
// from the first report day to mission end, so the empty space right of the AS OF line shows how
// much mission is left (the chart never shows data after the as-of date: analyzeCrew already cut it).
//
// Honesty rules from CLAUDE.md, applied to drawing:
//   - Missing values are gaps, never interpolated: days with no report get an empty row, and the
//     line does not connect across nulls.
//   - Readings measured differently (cm with no reference vs cm from the top) go on separate lines,
//     because the forecast treats them as not comparable either.
//   - State words ("empty", "full") and text with no number ("less than ¾") have no y-value. They are
//     shown as text pills in a "Crew notes" row under the x-axis, so their position never implies a
//     number (Phase 6, K4: replaced the diamond markers above the plot).
//   - Hovering any day shows what the crew wrote (raw_text) and the report quote.
//
// X-axis labels are day numbers ("12", "13", …) with the month written once under the first tick (and
// under any 1st of a month), so labels never run together; Recharts drops ticks when the chart is
// narrow (Phase 7). A resource with no number at all gets no chart: CrewNotesOnly (bottom of this
// file) lists its dated notes instead.

import { CartesianGrid, ComposedChart, Dot, Layer, Line, ReferenceLine, ResponsiveContainer, Text, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast, ResourceSeries, SeriesPoint } from "../lib/analyze.ts";
import { addDays, daysBetween } from "../lib/dates.ts";
import { RESOURCE_LABEL, num, pointValueText, shortDate, unitText } from "../ui/format.ts";

type Props = {
  series: ResourceSeries;
  forecast: Forecast | undefined;
  startDate: string; // first report day loaded: x = 0
  endDate: string; // mission end (or the last report day if later)
  asOf: string;
};

// One row per calendar day. g0, g1, … hold the value for each comparable group (null = gap).
type Row = { x: number; date: string; [group: string]: number | string | null };

// Every mark below is a Recharts component (Dot, Text, Layer = an SVG group): we choose sizes and
// colors but draw no shapes by hand (competition rule: no hand-made SVG drawings).

// The plot area's horizontal offsets inside the chart, in px: the YAxis width on the left (margin.left
// is 0) and margin.right on the right. The Crew notes row below the chart uses the same numbers, so
// its pills line up with the x-axis days.
const PLOT_LEFT = 52;
const PLOT_RIGHT = 20;

// Colors for the chart's SVG (CSS variables don't reach every Recharts attribute, so they are
// repeated here; keep in sync with src/styles/app.css).
const C = {
  line: "#6cb4ee", // the one accent
  line2: "#b6d7f2", // second comparable group, dashed
  grid: "#232b36",
  axis: "#8793a3",
  asOf: "#e6e9ee",
  refill: "#2cc5a6", // teal = nominal / replenished
  end: "#6b7686",
};

/** Rounds up to a "nice" axis maximum: 1, 2 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); // the power of ten just below v
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * Y-axis ticks from 0 to `top` with round steps. A top of 1/2 × 10ⁿ splits into quarters (0, 25,
 * 50, 75, 100); a top of 5 × 10ⁿ splits into fifths, because quarters of 50 would be 12.5 and 37.5
 * and the labels would round to "13" and "38" (Phase 6, Q2).
 */
function niceTicks(top: number): number[] {
  const parts = top / 10 ** Math.floor(Math.log10(top)) === 5 ? 5 : 4; // leading digit 5 → fifths
  return Array.from({ length: parts + 1 }, (_, i) => (top * i) / parts);
}

/** The group a numeric point belongs to: same unit and same measuring reference = comparable. */
const groupKey = (p: SeriesPoint) => `${p.unit}|${p.measured_from ?? "unstated"}`;

/**
 * Human label for a group key, e.g. "cm|unstated" → "cm (top/bottom not stated)".
 * "cm|top" says which way is good: a depth measured from the top grows as the water goes DOWN, so a
 * rising line there means less water (Phase 6, K5).
 */
function groupLabel(key: string): string {
  const [unit, from] = key.split("|");
  const u = unit === "percent" ? "%" : unit;
  if (from === "top") return `${u} from top (higher = less water)`;
  return from === "unstated" ? (unit === "cm" || unit === "in" ? `${u} (top/bottom not stated)` : u) : `${u} from ${from}`;
}

/** Day of the month as an axis label: "2015-01-13" → "13". */
const dayLabel = (iso: string) => String(Number(iso.slice(8, 10)));

/**
 * One x-axis tick: the day number, plus the month on a second line under the first tick and under the
 * 1st of a month (so a mission crossing into February says so). Recharts' own Text, no hand-drawn SVG.
 * @param props  What Recharts passes a custom tick: its position and payload.value (our day index x).
 */
function DayTick(props: { x?: number | string; y?: number | string; payload?: { value: unknown }; startDate: string }) {
  // Recharts types x/y as number | string; on a number axis they are pixel numbers, so Number() is exact.
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const { payload, startDate } = props;
  if (!payload || typeof payload.value !== "number") return null;
  const date = addDays(startDate, payload.value);
  const showMonth = payload.value === 0 || date.endsWith("-01");
  return (
    <Layer>
      <Text x={x} y={y + 4} textAnchor="middle" verticalAnchor="start" fill={C.axis} fontSize={11} fontFamily="IBM Plex Mono">
        {dayLabel(date)}
      </Text>
      {showMonth && (
        <Text x={x} y={y + 18} textAnchor="middle" verticalAnchor="start" fill={C.axis} fontSize={10} fontFamily="IBM Plex Mono">
          {shortDate(date).slice(0, 3).toUpperCase()}
        </Text>
      )}
    </Layer>
  );
}

/** The text and color of a Crew notes pill: the state word, or the crew's own words when there's no number. */
function notePill(p: SeriesPoint): { text: string; cls: string } {
  if (p.status === "empty") return { text: "EMPTY", cls: "note-pill--critical" };
  if (p.status === "half") return { text: "HALF", cls: "note-pill--warning" };
  if (p.status === "full") return { text: "FULL", cls: "note-pill--nominal" };
  return { text: p.raw_text ?? "", cls: "" }; // neutral: what the crew wrote, e.g. "less than ¾"
}

/**
 * Draws one resource chart.
 * @returns  A panel with title, the chart, and a one-line legend explaining markers.
 */
export function UsageChart({ series, forecast, startDate, endDate, asOf }: Props) {
  const points = series.points;
  const numeric = points.filter((p) => p.value !== null);
  const groups = [...new Set(numeric.map(groupKey))]; // distinct groups, in order of first appearance
  const percentOnly = groups.length > 0 && groups.every((g) => g.startsWith("percent|"));

  // Y range: percent is always 0–100; anything else 0 to a nice number above the biggest reading.
  const top = percentOnly ? 100 : niceMax(Math.max(0, ...numeric.map((p) => p.value!)) * 1.15);
  const ticks = niceTicks(top);

  // One row per calendar day from the first report to the last point, so no-report days are gaps.
  const byDate = new Map(points.map((p) => [p.date, p])); // Map from date → that day's point
  const lastDate = points.at(-1)?.date ?? startDate;
  const rows: Row[] = [];
  for (let x = 0; x <= daysBetween(startDate, lastDate); x++) {
    const date = addDays(startDate, x);
    const p = byDate.get(date);
    const row: Row = { x, date };
    groups.forEach((g, i) => (row[`g${i}`] = p && p.value !== null && groupKey(p) === g ? p.value : null));
    rows.push(row);
  }

  const xEnd = daysBetween(startDate, endDate);
  const xAsOf = daysBetween(startDate, asOf);
  const refills = points.filter((p) => p.refill).map((p) => daysBetween(startDate, p.date));
  const unit = groups.length > 0 ? groupLabel(groups[0]) : "";
  // Days with words but no number ("EMPTY", "less than ¾"): shown as pills under the x-axis.
  const notes = points.filter((p) => p.value === null && p.raw_text !== null);

  /**
   * The AS OF label above the as-of line. Centered on the line normally; anchored to the line's left
   * when the line is near the right edge (and to its right near the left edge), so the text is never
   * cut off by the chart's edge (Phase 6, K6). viewBox.x is the line's pixel position.
   */
  const asOfLabel = (props: { viewBox?: { x?: number; y?: number } }) => {
    const x = props.viewBox?.x ?? 0;
    const y = (props.viewBox?.y ?? 0) - 10;
    const share = xEnd > 0 ? xAsOf / xEnd : 0; // 0 = left edge, 1 = right edge
    const anchor = share > 0.75 ? "end" : share < 0.2 ? "start" : "middle";
    const dx = anchor === "end" ? -6 : anchor === "start" ? 6 : 0; // keep clear of the line itself
    return (
      <Text x={x + dx} y={y} textAnchor={anchor} fill={C.asOf} fontSize={10} fontFamily="IBM Plex Mono">
        {`AS OF ${shortDate(asOf).toUpperCase()}`}
      </Text>
    );
  };

  // Recharts passes the data row it is drawing as `payload`. We read the date from it, never from
  // rows[index]: Recharts 3 keeps point positions in an internal store that can lag one render behind
  // `data`, so right after switching to an EARLIER day (fewer rows) it may call this with an index from
  // the old, longer data — rows[index] was then undefined and crashed the page (Phase 6 bug K1).
  const valueDot = (color: string) => (props: { cx?: number; cy?: number; index?: number; value?: unknown; payload?: Row }) => {
    const p = props.payload ? byDate.get(props.payload.date) : undefined;
    if (!p || props.cx === undefined || props.cy === undefined || props.value === null || props.value === undefined) return <Layer key={props.index} />;
    const { cx, cy } = props;
    return (
      <Layer key={props.index}>
        <Dot cx={cx} cy={cy} r={4} fill={p.approximate ? "#151a21" : color} stroke={color} strokeWidth={2} />
        {p.approximate && (
          <Text x={cx} y={cy - 9} textAnchor="middle" fill={color} fontSize={12} fontFamily="IBM Plex Mono">
            ~
          </Text>
        )}
      </Layer>
    );
  };

  return (
    <figure className="chart panel">
      <figcaption className="chart__head">
        <h3>{RESOURCE_LABEL[series.resource]}</h3>
        <span className="chart__unit mono">{unit || "no numeric readings"}</span>
      </figcaption>
      <div className="chart__plot">
        {/* ResponsiveContainer resizes the SVG to its parent's width; the height is fixed. */}
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={rows} margin={{ top: 24, right: PLOT_RIGHT, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            {/* type="number" puts days at their true spacing (Jan 19 → 21 leaves a gap) and lets the
                axis run to mission end even though no rows exist there yet. */}
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, xEnd]}
              ticks={Array.from({ length: xEnd + 1 }, (_, i) => i)}
              // tickFormatter is what Recharts measures to decide which ticks fit; DayTick draws them.
              tickFormatter={(x: number) => dayLabel(addDays(startDate, x))}
              interval="equidistantPreserveStart"
              minTickGap={10}
              height={36}
              stroke={C.axis}
              tick={(t) => <DayTick x={t.x} y={t.y} payload={t.payload} startDate={startDate} />}
              tickLine={false}
            />
            <YAxis
              domain={[0, top]}
              ticks={ticks}
              tickFormatter={(v: number) => (groups.length ? num(v, 0) : "")}
              stroke={C.axis}
              width={PLOT_LEFT}
              tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
              tickLine={false}
              label={groups.length ? { value: unitText(numeric[0].unit), angle: -90, position: "insideLeft", fill: C.axis, fontSize: 11, dx: 12 } : undefined}
            />
            {/* filterNull={false}: still show the tooltip on days whose value is null (they have text). */}
            <Tooltip content={(p) => <ChartTooltip active={p.active} label={p.label} byDate={byDate} rows={rows} />} filterNull={false} cursor={{ stroke: C.axis, strokeDasharray: "2 3" }} isAnimationActive={false} />
            {refills.map((x) => (
              <ReferenceLine key={`r${x}`} x={x} stroke={C.refill} strokeDasharray="4 3" label={{ value: "REFILL", position: "insideBottomLeft", fill: C.refill, fontSize: 10, fontFamily: "IBM Plex Mono" }} />
            ))}
            <ReferenceLine x={xEnd} stroke={C.end} strokeDasharray="2 4" label={{ value: "MISSION END", position: "insideBottomRight", fill: C.end, fontSize: 10, fontFamily: "IBM Plex Mono" }} />
            <ReferenceLine x={xAsOf} stroke={C.asOf} strokeWidth={1.5} label={asOfLabel} />
            {groups.map((g, i) => (
              <Line
                key={g}
                dataKey={`g${i}`}
                name={groupLabel(g)}
                stroke={i === 0 ? C.line : C.line2}
                strokeDasharray={i === 0 ? undefined : "6 4"}
                strokeWidth={2.5}
                connectNulls={false} // a null is a gap: never draw a line through missing data
                dot={valueDot(i === 0 ? C.line : C.line2)}
                activeDot={false}
                // A short line draw when a chart appears (each day change remounts it). matchMedia: no
                // animation for viewers who asked their OS for reduced motion, as in the CSS.
                isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches}
                animationDuration={400}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {notes.length > 0 && <CrewNotes notes={notes} startDate={startDate} xEnd={xEnd} />}
      <ChartFooter series={series} forecast={forecast} groups={groups} />
    </figure>
  );
}

/** Small line under a chart: which line is which (when there are several) and what the rate says. */
function ChartFooter({ series, forecast, groups }: { series: ResourceSeries; forecast: Forecast | undefined; groups: string[] }) {
  const hasNotes = series.points.some((p) => p.value === null && p.raw_text !== null);
  const fromTop = groups.some((g) => g.endsWith("|top"));
  return (
    <div className="chart__foot">
      {/* With one group the unit is in the header; a from-top line always gets its legend line,
          because its "higher = less water" note matters even when it is the only line. */}
      {(groups.length > 1 || fromTop) &&
        groups.map((g, i) => (
          <span key={g} className="legend-item">
            {/* Line sample as a CSS border (solid = first group, dashed = second), matching the chart lines. */}
            <span className={`legend-swatch ${i === 0 ? "" : "legend-swatch--dashed"}`} aria-hidden="true" />
            {groupLabel(g)}
          </span>
        ))}
      {groups.length > 1 && <span className="dim">Different references are not comparable, so they are separate lines.</span>}
      {fromTop && <span className="dim">Measured from the top of the tank: the number is the empty space above the water, so a rising line means the water is going down.</span>}
      {hasNotes && <span className="dim">Crew notes: days the crew described the level in words (EMPTY / HALF / FULL) or gave no usable number. Hover a note or the day for the quote.</span>}
      {forecast?.rate_per_day != null && forecast.latest && (
        <span className="mono">
          rate {num(forecast.rate_per_day)} {unitText(forecast.latest.unit)}/day over {forecast.points_used} readings
        </span>
      )}
    </div>
  );
}

/**
 * The "Crew notes" row under the x-axis: one text pill per day the crew described the level in words.
 * Plain HTML/CSS, not SVG: the inner track has the plot area's exact width (PLOT_LEFT/PLOT_RIGHT), so
 * a day's left % matches its x-axis position. Neighboring days alternate between two lanes so pills
 * never overlap. Each pill may be as wide as the gap to the next pill in its lane (at most 4 days), so
 * a lone "less than ¾" shows in full and only crowded days are cut with "…" (full text on hover).
 */
function CrewNotes({ notes, startDate, xEnd }: { notes: SeriesPoint[]; startDate: string; xEnd: number }) {
  return (
    <div className="crew-notes" style={{ paddingLeft: PLOT_LEFT, paddingRight: PLOT_RIGHT }}>
      <span className="crew-notes__label" style={{ width: PLOT_LEFT }}>
        Crew notes
      </span>
      <div className="crew-notes__track">
        {notes.map((p) => {
          const x = daysBetween(startDate, p.date);
          const { text, cls } = notePill(p);
          // Days to the nearest pill in the same lane (same even/odd day), capped at 4.
          const gap = Math.min(4, ...notes.map((n) => Math.abs(daysBetween(startDate, n.date) - x)).filter((d) => d > 0 && d % 2 === 0));
          // Centered pills split the gap with their neighbor and stay inside the plot; edge pills (anchored
          // inside) get half the gap, because their neighbor reaches toward them by half its own width.
          const centered = Math.min(gap, 2 * x + 1, 2 * (xEnd - x) + 1);
          const widthDays = x === 0 || x === xEnd ? gap / 2 : centered;
          return (
            <span
              key={p.date}
              // Edge days anchor to the inside (like the AS OF label) so a pill never sticks out of the plot.
              className={`note-pill mono ${cls} ${x % 2 === 0 ? "" : "note-pill--lower"} ${x === 0 ? "note-pill--start" : x === xEnd ? "note-pill--end" : ""}`}
              style={{ left: `${(x / Math.max(1, xEnd)) * 100}%`, maxWidth: `calc(${(widthDays / Math.max(1, xEnd)) * 100}% - 4px)` }}
              title={`${shortDate(p.date)} — crew wrote “${p.raw_text}”${p.source_quote ? `: “${p.source_quote}”` : ""} (${p.report_kind} report)`}
            >
              {text}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Rows for resources the crew only ever described in words (no number up to the as-of date), e.g. the
 * loft tank "half-empty" → "full". An empty chart would say nothing, so each gets one compact row:
 * its name and a dated pill per note, in the same pill styles as the charts' Crew notes row.
 * The first row lists the crew's total-water estimates (water_total), which are never charted.
 * @param series     The words-only series, in display order.
 * @param estimates  water_total points with a number ("~360 L" on Jan 13); empty = none reported yet.
 */
export function CrewNotesOnly({ series, estimates }: { series: ResourceSeries[]; estimates: SeriesPoint[] }) {
  return (
    <section className="notes-only panel" aria-label="Crew notes only">
      <div className="notes-only__head">
        <h3>Crew notes and estimates</h3>
        <span className="dim small">Not charted: words only, or occasional volume estimates. Hover for the quote.</span>
      </div>
      {/* The crew's total-water estimates, listed rather than plotted (an estimate is not a measurement). */}
      <div className="notes-only__row volume-estimates">
        <span className="notes-only__name">Crew volume estimates: {estimates.length}</span>
        <div className="notes-only__pills">
          {estimates.length === 0 ? (
            <span className="dim small">No volume estimate reported yet.</span>
          ) : (
            <>
              {estimates.map((p) => (
                <span key={p.date} className="note-pill note-pill--inline mono" title={`${shortDate(p.date)} — “${p.source_quote}” (${p.report_kind} report)`}>
                  {pointValueText(p)} <span className="note-pill__date">on {shortDate(p.date)}</span>
                </span>
              ))}
              <span className="dim small">No later estimate — see the Water panel.</span>
            </>
          )}
        </div>
      </div>
      {series.map((s) => (
        <div className="notes-only__row" key={s.resource}>
          <span className="notes-only__name">{RESOURCE_LABEL[s.resource]}</span>
          <div className="notes-only__pills">
            {s.points
              .filter((p) => p.raw_text !== null)
              .map((p) => {
                const { text, cls } = notePill(p);
                return (
                  <span
                    key={p.date}
                    className={`note-pill note-pill--inline mono ${cls}`}
                    title={`${shortDate(p.date)} — crew wrote “${p.raw_text}”${p.source_quote ? `: “${p.source_quote}”` : ""} (${p.report_kind} report)`}
                  >
                    <span className="note-pill__date">{shortDate(p.date)}</span> {text}
                  </span>
                );
              })}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Hover card: the date, what the crew wrote, the value we read from it, and the quote. */
function ChartTooltip(props: { active?: boolean; label?: unknown; byDate: Map<string, SeriesPoint>; rows: Row[] }) {
  const { active, label, byDate, rows } = props;
  if (!active || typeof label !== "number") return null;
  const row = rows.find((r) => r.x === label);
  if (!row) return null; // hovering the future part of the axis: nothing to show
  const p = byDate.get(row.date);
  return (
    <div className="tooltip">
      <div className="tooltip__date mono">{shortDate(row.date)}</div>
      {!p ? (
        <div className="dim">No report this day</div>
      ) : p.raw_text === null ? (
        <div className="dim">Not mentioned in this day's reports</div>
      ) : (
        <>
          <div>
            <span className="dim">Crew wrote </span>
            <span className="mono">“{p.raw_text}”</span>
          </div>
          <div>
            <span className="dim">Read as </span>
            <span className="mono">{pointValueText(p) ?? "no number (not plotted)"}</span>
            {p.refill && <span className="tag tag--nominal">REFILL</span>}
          </div>
          {p.change_from_previous !== null && (
            <div className="dim mono">
              change {num(p.change_from_previous)} {unitText(p.unit)}
              {p.change_per_day !== null && ` (${num(p.change_per_day)}/day)`}
            </div>
          )}
          {p.source_quote && <blockquote className="tooltip__quote">“{p.source_quote}”</blockquote>}
          <div className="dim small">
            {p.report_kind} report{p.evidence.length > 1 && ` · ${p.evidence.length} quotes this day`}
          </div>
        </>
      )}
    </div>
  );
}
