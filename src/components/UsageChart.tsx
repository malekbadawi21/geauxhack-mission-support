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
//     drawn as labeled markers in a band above the axis, so their position never implies a number.
//   - Hovering any day shows what the crew wrote (raw_text) and the report quote.

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

// One row per calendar day. g0, g1, … hold the value for each comparable group (null = gap);
// lane holds the y of the marker band when that day has a reading without a number.
type Row = { x: number; date: string; lane: number | null; [group: string]: number | string | null };

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
  lane: "#c9d1db",
};

/** Rounds up to a "nice" axis maximum: 1, 2 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); // the power of ten just below v
  for (const m of [1, 2, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** The group a numeric point belongs to: same unit and same measuring reference = comparable. */
const groupKey = (p: SeriesPoint) => `${p.unit}|${p.measured_from ?? "unstated"}`;

/** Human label for a group key, e.g. "cm|top" → "cm from top", "cm|unstated" → "cm (reference not stated)". */
function groupLabel(key: string): string {
  const [unit, from] = key.split("|");
  const u = unit === "percent" ? "%" : unit;
  return from === "unstated" ? (unit === "cm" || unit === "in" ? `${u} (top/bottom not stated)` : u) : `${u} from ${from}`;
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
  const laneY = top * 1.1; // the marker band sits above the highest tick
  const ticks = [0, top / 4, top / 2, (3 * top) / 4, top];

  // One row per calendar day from the first report to the last point, so no-report days are gaps.
  const byDate = new Map(points.map((p) => [p.date, p])); // Map from date → that day's point
  const lastDate = points.at(-1)?.date ?? startDate;
  const rows: Row[] = [];
  for (let x = 0; x <= daysBetween(startDate, lastDate); x++) {
    const date = addDays(startDate, x);
    const p = byDate.get(date);
    const row: Row = { x, date, lane: null };
    groups.forEach((g, i) => (row[`g${i}`] = p && p.value !== null && groupKey(p) === g ? p.value : null));
    // A reading with no number (state word or unparsed text) gets a marker in the band.
    if (p && p.value === null && p.raw_text !== null) row.lane = laneY;
    rows.push(row);
  }

  const xEnd = daysBetween(startDate, endDate);
  const xAsOf = daysBetween(startDate, asOf);
  const refills = points.filter((p) => p.refill).map((p) => daysBetween(startDate, p.date));
  const unit = groups.length > 0 ? groupLabel(groups[0]) : "";

  /**
   * Marker in the band above the axis for a reading without a number. A state word ("empty", "full")
   * is a filled diamond with its label; text with no usable number is a hollow diamond (hover shows it).
   * Labels sit centered above the diamond on even days and below it on odd days, so neighbors never overlap.
   */
  const laneDot = (props: { cx?: number; cy?: number; index?: number }) => {
    const p = props.index !== undefined ? byDate.get(rows[props.index].date) : undefined;
    // Recharts calls this for every row; rows without a marker draw an empty group.
    if (!p || props.cx === undefined || props.cy === undefined || rows[props.index!].lane === null) return <g key={props.index} />;
    const { cx, cy } = props;
    const labelY = rows[props.index!].x % 2 === 0 ? cy - 9 : cy + 17; // % 2 = even/odd day
    return (
      <g key={props.index}>
        {/* A diamond: a square rotated 45° around its center. */}
        <rect x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`} fill={p.status ? C.lane : "none"} stroke={C.lane} strokeWidth={1.5} />
        {p.status && (
          <text x={cx} y={labelY} textAnchor="middle" fill={C.lane} fontSize={10} fontFamily="IBM Plex Mono" letterSpacing={0.5}>
            {p.status.toUpperCase()}
          </text>
        )}
      </g>
    );
  };

  /** Value dot: solid for an exact reading, hollow with "~" for an approximate one. */
  const valueDot = (color: string) => (props: { cx?: number; cy?: number; index?: number; value?: unknown }) => {
    const p = props.index !== undefined ? byDate.get(rows[props.index].date) : undefined;
    if (!p || props.cx === undefined || props.cy === undefined || props.value === null || props.value === undefined) return <g key={props.index} />;
    const { cx, cy } = props;
    return (
      <g key={props.index}>
        <circle cx={cx} cy={cy} r={4} fill={p.approximate ? "#151a21" : color} stroke={color} strokeWidth={2} />
        {p.approximate && (
          <text x={cx} y={cy - 9} textAnchor="middle" fill={color} fontSize={12} fontFamily="IBM Plex Mono">
            ~
          </text>
        )}
      </g>
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
          <ComposedChart data={rows} margin={{ top: 32, right: 20, bottom: 4, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            {/* type="number" puts days at their true spacing (Jan 19 → 21 leaves a gap) and lets the
                axis run to mission end even though no rows exist there yet. */}
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, xEnd]}
              ticks={Array.from({ length: xEnd + 1 }, (_, i) => i)}
              tickFormatter={(x: number) => shortDate(addDays(startDate, x))}
              interval="equidistantPreserveStart"
              stroke={C.axis}
              tick={{ fontSize: 11, fontFamily: "IBM Plex Mono" }}
              tickLine={false}
            />
            <YAxis
              domain={[0, top * 1.18]}
              ticks={ticks}
              tickFormatter={(v: number) => (groups.length ? num(v, 0) : "")}
              stroke={C.axis}
              width={52}
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
            <ReferenceLine x={xAsOf} stroke={C.asOf} strokeWidth={1.5} label={{ value: `AS OF ${shortDate(asOf).toUpperCase()}`, position: "top", offset: 14, fill: C.asOf, fontSize: 10, fontFamily: "IBM Plex Mono" }} />
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
                isAnimationActive={false} // motion is reserved for the pipeline (design rule)
              />
            ))}
            <Line dataKey="lane" stroke="none" dot={laneDot} activeDot={false} legendType="none" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ChartFooter series={series} forecast={forecast} groups={groups} />
    </figure>
  );
}

/** Small line under a chart: which line is which (when there are several) and what the rate says. */
function ChartFooter({ series, forecast, groups }: { series: ResourceSeries; forecast: Forecast | undefined; groups: string[] }) {
  const hasLane = series.points.some((p) => p.value === null && p.raw_text !== null);
  return (
    <div className="chart__foot">
      {groups.length > 1 &&
        groups.map((g, i) => (
          <span key={g} className="legend-item">
            <svg width="22" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="22" y2="4" stroke={i === 0 ? C.line : C.line2} strokeWidth="2.5" strokeDasharray={i === 0 ? undefined : "6 4"} />
            </svg>
            {groupLabel(g)}
          </span>
        ))}
      {groups.length > 1 && <span className="dim">Different references are not comparable, so they are separate lines.</span>}
      {hasLane && <span className="dim">Diamonds above the axis have no number: filled = state word (EMPTY / HALF / FULL), hollow = text we could not read as a level. Hover for what the crew wrote.</span>}
      {forecast?.rate_per_day != null && forecast.latest && (
        <span className="mono">
          rate {num(forecast.rate_per_day)} {unitText(forecast.latest.unit)}/day over {forecast.points_used} readings
        </span>
      )}
    </div>
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
