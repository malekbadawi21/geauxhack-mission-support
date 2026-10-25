// FlagsList.tsx — every alert from our deterministic rules (flags.ts), most severe first.
//
// How it fits: renders analysis.flags (already sorted critical → warning → info). Each row expands
// to show the report quotes that justify the flag, each marked verified or not. The daily report's
// concerns link here by flag id, so App.tsx owns which rows are open. Critical flags the crew
// acknowledged in the alert dialog (CriticalAlertDialog.tsx) get a small "Acknowledged" tag.

import { ChevronRight } from "lucide-react";
import type { Flag } from "../lib/analyze.ts";
import type { SavedExtraction } from "../lib/schema.ts";
import { RESOURCE_LABEL, TYPE_LABEL, flagAnchor, quoteVerified, readableMessage } from "../ui/format.ts";
import { Quote } from "./Quote.tsx";

type Props = {
  flags: Flag[];
  received: SavedExtraction[]; // the loaded reports, to look up whether each quote was verified
  open: Set<string>; // ids of expanded rows
  onToggle: (id: string) => void;
  acknowledged: Set<string>; // ids acknowledged in the critical-alert dialog this session
};

/** Renders the flags section. */
export function FlagsList({ flags, received, open, onToggle, acknowledged }: Props) {
  return (
    <section className="section" id="flags" aria-labelledby="flags-title">
      <div className="section__head">
        <h2 id="flags-title">Flags</h2>
        <p className="section__sub">
          Deterministic rules on verified readings — never the model's labels. {flags.length} for this day.
        </p>
      </div>
      {flags.length === 0 ? (
        <p className="panel empty">No flags for this day.</p>
      ) : (
        <ul className="flags panel">
          {flags.map((f) => {
            const isOpen = open.has(f.id);
            return (
              <li key={f.id} id={flagAnchor(f.id)} className={`flag flag--${f.severity} ${isOpen ? "flag--open" : ""}`}>
                {/* aria-expanded tells screen readers whether the evidence below is showing. */}
                <button className="flag__row" aria-expanded={isOpen} onClick={() => onToggle(f.id)}>
                  <ChevronRight className="flag__chevron" size={16} aria-hidden="true" />
                  <span className={`sev sev--${f.severity}`}>{f.severity.toUpperCase()}</span>
                  <span className="flag__type">{TYPE_LABEL[f.type]}</span>
                  <span className="flag__res">{f.resource ? RESOURCE_LABEL[f.resource] : ""}</span>
                  <span className="flag__msg">
                    {readableMessage(f.message)}
                    {acknowledged.has(f.id) && <span className="ack-tag small">Acknowledged</span>}
                  </span>
                  <span className="flag__n small dim mono">
                    {f.evidence.length} quote{f.evidence.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isOpen && (
                  <div className="flag__body">
                    <div className="mono small dim flag__id">{f.id}</div>
                    {f.evidence.length === 0 && <p className="dim small">No quote attached to this flag.</p>}
                    {f.evidence.map((e, i) => (
                      <Quote key={i} quote={e.quote} reportKind={e.report_kind} verified={quoteVerified(received, e.report_kind, e.quote)} />
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
