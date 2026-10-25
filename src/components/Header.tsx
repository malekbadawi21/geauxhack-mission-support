// Header.tsx — the sticky top bar: product, crew, as-of date, mode, Upload, and the day scrubber.
//
// How it fits: always visible while scrolling, so the as-of date and the mode can never be missed
// (a replay must never pass for live). The scrubber's second row lists the report days loaded so far;
// clicking one makes App.tsx re-run analyzeCrew for that as-of date (no look-ahead).

import { Orbit, Upload } from "lucide-react";
import { PRODUCT_NAME } from "../ui/config.ts";
import { longDate, shortDate } from "../ui/format.ts";
import type { Mode } from "../ui/pipeline.ts";

type Props = {
  crewName: string;
  asOf: string;
  mode: Mode;
  busy: boolean; // a pipeline run is in progress: mode and days are locked
  onMode: (m: Mode) => void;
  onUpload: () => void;
  dates: string[]; // report days loaded, oldest first
  onDate: (d: string) => void;
  moreDays: { count: number; through: string } | null; // recorded days not loaded yet (Replay only)
  onLoadMore: () => void;
};

/** Renders the header and scrubber. */
export function Header(p: Props) {
  return (
    <header className="topbar">
      <div className="topbar__row">
        <div className="brand">
          {/* Brand mark: a lucide icon, colored by .brand__mark (competition rule: no drawn logos). */}
          <Orbit className="brand__mark" size={22} aria-hidden="true" />
          <span className="brand__name">{PRODUCT_NAME}</span>
          <span className="brand__crew">{p.crewName}</span>
        </div>

        <div className="asof">
          <span className="asof__label">AS OF</span>
          <span className="asof__date mono">{longDate(p.asOf)}</span>
        </div>

        <div className="topbar__controls">
          {/* The badge says exactly what the viewer is looking at. */}
          <span className={`mode-badge mode-badge--${p.mode}`}>{p.mode === "replay" ? "Replay — recorded run" : "Live"}</span>
          <div className="segmented" role="radiogroup" aria-label="Mode">
            {(["replay", "live"] as const).map((m) => (
              <button key={m} role="radio" aria-checked={p.mode === m} className={p.mode === m ? "is-on" : ""} disabled={p.busy} onClick={() => p.onMode(m)}>
                {m === "replay" ? "Replay" : "Live"}
              </button>
            ))}
          </div>
          <button className="btn btn--primary" onClick={p.onUpload} disabled={p.busy}>
            <Upload size={16} aria-hidden="true" /> Upload report
          </button>
        </div>
      </div>

      <nav className="scrubber" aria-label="Report days">
        <span className="scrubber__label">Report days</span>
        <div className="scrubber__days" role="radiogroup" aria-label="As-of date">
          {p.dates.map((d) => (
            <button key={d} role="radio" aria-checked={d === p.asOf} className={`day mono ${d === p.asOf ? "is-on" : ""}`} disabled={p.busy} onClick={() => p.onDate(d)}>
              {shortDate(d)}
            </button>
          ))}
        </div>
        {p.moreDays && (
          <button className="btn btn--ghost btn--small" onClick={p.onLoadMore} disabled={p.busy}>
            Load recorded days through {shortDate(p.moreDays.through)} ({p.moreDays.count} reports)
          </button>
        )}
      </nav>
    </header>
  );
}
