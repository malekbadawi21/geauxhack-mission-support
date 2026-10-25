// PipelinePanel.tsx — shows an upload moving through the pipeline stages.
//
// How it fits: App.tsx advances a PipelineState (src/ui/pipeline.ts) and this panel draws it: a
// stepper across the top (Reading reports → … → Daily report ready), the per-file notes, and the
// agent's trace steps appearing one by one. In Replay mode it says the run is recorded; on a Live
// error it shows the message plainly and offers "Switch to replay".

import { Check, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { STAGES, type PipelineState } from "../ui/pipeline.ts";
import { TraceTimeline } from "./AgentTrace.tsx";

type Props = { state: PipelineState; onClose: () => void; onSwitchToReplay: () => void; onViewReport: () => void };

/** Renders the pipeline panel. */
export function PipelinePanel({ state, onClose, onSwitchToReplay, onViewReport }: Props) {
  const current = STAGES.findIndex((s) => s.id === state.stage);
  const done = state.stage === "ready";
  const finished = done || state.error !== null; // nothing more will happen: allow closing

  return (
    <section className={`pipeline panel ${state.error ? "pipeline--error" : ""}`} aria-live="polite" aria-label="Upload pipeline">
      <header className="pipeline__head">
        <h2 className="pipeline__title">
          Processing {state.files.length} report{state.files.length === 1 ? "" : "s"}
          <span className="dim small mono"> {state.files.join(" · ")}</span>
        </h2>
        <span className={`mode-badge mode-badge--${state.mode}`}>{state.mode === "replay" ? "Replay — recorded run, demo pacing" : "Live"}</span>
        {finished && (
          <button className="icon-btn" onClick={onClose} aria-label="Close pipeline panel">
            <X size={18} />
          </button>
        )}
      </header>

      {/* The stepper: each stage is done, active, or waiting — with a text state, not just color. */}
      <ol className="stepper">
        {STAGES.map((s, i) => {
          const status = i < current || done ? "done" : i === current ? (state.error ? "failed" : "active") : "waiting";
          return (
            <li key={s.id} className={`step step--${status}`}>
              <span className="step__icon" aria-hidden="true">
                {status === "done" ? <Check size={14} /> : status === "active" ? <LoaderCircle size={14} className="spin" /> : status === "failed" ? <TriangleAlert size={14} /> : i + 1}
              </span>
              <span className="step__label">{s.label}</span>
              <span className="visually-hidden">({status})</span>
            </li>
          );
        })}
      </ol>

      <div className="pipeline__body">
        <div className="pipeline__notes">
          {state.files.map((f) =>
            state.fileNotes[f] ? (
              <div key={f} className="small appear">
                <span className="mono">{f}</span> <span className="dim">— {state.fileNotes[f]}</span>
              </div>
            ) : null,
          )}
          {state.analysisNote && <div className="small appear">{state.analysisNote}</div>}
          {state.note && <div className="small appear warn-text">{state.note}</div>}
          {state.error && (
            <div className="pipeline__error" role="alert">
              <strong>Live run failed.</strong> {state.error}
              <div className="pipeline__actions">
                <button className="btn btn--primary" onClick={onSwitchToReplay}>
                  Switch to replay
                </button>
              </div>
            </div>
          )}
          {done && state.run && (
            <button className="btn btn--primary appear" onClick={onViewReport}>
              View daily report
            </button>
          )}
        </div>
        {state.run && state.traceShown > 0 && (
          <div className="pipeline__trace">
            <div className="block-title">Agent investigating</div>
            <TraceTimeline steps={state.run.trace} shown={state.traceShown} compact />
          </div>
        )}
      </div>
    </section>
  );
}
