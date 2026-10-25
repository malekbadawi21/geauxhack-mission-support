// CriticalAlertDialog.tsx — a pop-up the crew must acknowledge, listing the day's CRITICAL flags.
//
// How it fits: App.tsx shows it once an upload reaches "Daily report ready" (Replay or Live) and the
// day on screen has critical flags the crew hasn't acknowledged yet. It adds nothing new: each block
// is the flag exactly as the Flags table shows it (type label, resource, readable message) plus its
// verified quotes. Severity comes from flags.ts rules, never from Gemini. The only way out is the
// Acknowledge button: no close X, the backdrop does nothing, and Escape is ignored.

import { useEffect, useRef, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import type { Flag } from "../lib/analyze.ts";
import type { SavedExtraction } from "../lib/schema.ts";
import { RESOURCE_LABEL, TYPE_LABEL, longDate, quoteVerified, readableMessage } from "../ui/format.ts";
import { Quote } from "./Quote.tsx";

type Props = {
  asOf: string; // the day the flags are for, shown in the title
  flags: Flag[]; // already filtered with flagsForAlert (format.ts)
  received: SavedExtraction[]; // the loaded reports, to keep only verified quotes
  onAcknowledge: () => void;
};

/** Renders the dialog. */
export function CriticalAlertDialog({ asOf, flags, received, onAcknowledge }: Props) {
  const ackRef = useRef<HTMLButtonElement>(null);

  // On open: remember what had focus and move focus to Acknowledge. The returned function runs when
  // the dialog closes (unmounts) and puts focus back where it was.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; // `as`: activeElement is typed as plain Element
    ackRef.current?.focus();
    return () => previous?.focus();
  }, []);

  /** Keyboard rules: Escape does not dismiss, and Tab can't leave (Acknowledge is the only control). */
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") e.preventDefault();
  };

  return (
    // onMouseDown preventDefault: a click on the backdrop must not move focus out of the dialog.
    <div className="overlay overlay--alert" onMouseDown={(e) => e.preventDefault()}>
      <div className="dialog panel alert" role="dialog" aria-modal="true" aria-labelledby="alert-title" onKeyDown={onKeyDown}>
        <h2 id="alert-title" className="alert__title">
          <AlertTriangle size={20} aria-hidden="true" /> Critical alert — {longDate(asOf)}
        </h2>
        {flags.map((f) => {
          const quotes = f.evidence.filter((e) => quoteVerified(received, e.report_kind, e.quote) === true);
          return (
            <div key={f.id} className="alert__flag">
              <div className="alert__flag-title">
                {/* The word "CRITICAL" in text, so severity isn't shown by color alone. */}
                <span className="sev sev--critical">CRITICAL</span> {TYPE_LABEL[f.type]}
                {f.resource && <span className="dim"> · {RESOURCE_LABEL[f.resource]}</span>}
              </div>
              <p className="alert__msg">{readableMessage(f.message)}</p>
              {quotes.length === 0 && <p className="dim small">No verified quote attached to this flag.</p>}
              {quotes.map((e, i) => (
                <Quote key={i} quote={e.quote} reportKind={e.report_kind} verified={true} />
              ))}
            </div>
          );
        })}
        <div className="alert__actions">
          <button ref={ackRef} className="btn btn--primary" onClick={onAcknowledge}>
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
}
