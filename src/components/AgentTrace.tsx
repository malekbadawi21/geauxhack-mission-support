// AgentTrace.tsx — how the agent got to its report: a vertical timeline of its tool calls.
//
// How it fits: renders DemoRun.trace (AgentTraceStep[] from src/lib/report-types.ts). Used twice:
// in the pipeline panel while steps appear one by one (`shown` limits how many), and as the full
// "Agent trace" section at the bottom of the page.

import type { AgentTraceStep } from "../lib/report-types.ts";

type Props = { steps: AgentTraceStep[]; shown?: number; compact?: boolean };

/** Renders the timeline. `shown` = how many steps are visible (default all). */
export function TraceTimeline({ steps, shown = steps.length, compact = false }: Props) {
  return (
    <ol className={`trace ${compact ? "trace--compact" : ""}`}>
      {steps.slice(0, shown).map((s) => (
        <li key={s.step} className="trace__step appear">
          <span className="trace__dot" aria-hidden="true" />
          <div className="trace__head">
            <span className="trace__n mono">{String(s.step).padStart(2, "0")}</span>
            <span className="trace__tool mono">{s.tool}</span>
            <span className="trace__ms mono dim">{s.ms} ms</span>
          </div>
          <div className="trace__io small">
            <div>
              <span className="trace__k">in</span> {s.input_summary}
            </div>
            <div>
              <span className="trace__k">out</span> {s.output_summary}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The "Agent trace" section at the bottom of the page. */
export function AgentTrace({ steps, model }: { steps: AgentTraceStep[] | null; model: string | null }) {
  const total = steps?.reduce((sum, s) => sum + s.ms, 0) ?? 0; // reduce adds up every step's ms
  return (
    <section className="section" id="trace" aria-labelledby="trace-title">
      <div className="section__head">
        <h2 id="trace-title">Agent trace</h2>
        <p className="section__sub">
          {steps ? `${steps.length} tool calls · ${total} ms in tools · ${model}` : "Tool calls the agent made before writing the report."}
        </p>
      </div>
      {steps ? (
        <div className="panel trace-panel">
          <TraceTimeline steps={steps} />
        </div>
      ) : (
        <p className="panel empty">No agent run for this date.</p>
      )}
    </section>
  );
}
