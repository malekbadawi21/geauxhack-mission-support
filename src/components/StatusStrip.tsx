// StatusStrip.tsx — the one-line summary under the header: overall status and flag counts.
//
// How it fits: the overall status comes from the agent's daily report for the as-of date (if one
// exists); the counts come from analysis.flags, which are our deterministic rules. The two are kept
// visibly separate so a viewer can tell the agent's judgment from the rules' output.

import type { Analysis } from "../lib/analyze.ts";
import type { DailyReport } from "../lib/report-types.ts";
import { shortDate } from "../ui/format.ts";

// Label and CSS modifier for each overall status. Text is always shown, never color alone.
const OVERALL: Record<DailyReport["overall"], { label: string; cls: string }> = {
  nominal: { label: "NOMINAL", cls: "nominal" },
  caution: { label: "CAUTION", cls: "warning" },
  critical: { label: "CRITICAL", cls: "critical" },
};

/** Renders the status strip. `report` is the daily report for analysis.asOf, or null. */
export function StatusStrip({ analysis, report }: { analysis: Analysis; report: DailyReport | null }) {
  const count = (s: string) => analysis.flags.filter((f) => f.severity === s).length;
  const critical = count("critical");
  const warning = count("warning");
  const info = count("info");
  const overall = report ? OVERALL[report.overall] : null;

  return (
    <section className={`status panel ${overall ? `status--${overall.cls}` : ""}`} aria-label="Status">
      <div className="status__overall">
        <span className="status__kicker">Daily report</span>
        {overall ? (
          <span className={`status__badge status__badge--${overall.cls}`}>{overall.label}</span>
        ) : (
          <span className="status__badge status__badge--none">NO REPORT YET</span>
        )}
      </div>
      <p className="status__line">
        {report ? report.status_line : `No daily report for ${shortDate(analysis.asOf)}. The agent writes one when a day's reports are uploaded.`}
      </p>
      <div className="status__counts" aria-label="Flag counts">
        <a href="#flags" className="count count--critical">
          <span className="count__n mono">{critical}</span> critical
        </a>
        <a href="#flags" className="count count--warning">
          <span className="count__n mono">{warning}</span> warning
        </a>
        <a href="#flags" className="count count--info">
          <span className="count__n mono">{info}</span> info
        </a>
        <span className="dim small status__src">
          {analysis.reportCount} reports · latest {analysis.latestReportDate ? shortDate(analysis.latestReportDate) : "none"}
          {analysis.latestReportKinds.length > 0 && ` (${analysis.latestReportKinds.join(" + ")})`}
        </span>
      </div>
    </section>
  );
}
