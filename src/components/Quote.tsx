// Quote.tsx — a report quotation with its verification mark and the report it came from.
//
// How it fits: FlagsList uses it for every piece of evidence. The verified mark comes from
// verify.ts's substring check (looked up via quoteVerified in format.ts), never from Gemini.

import { Check, TriangleAlert } from "lucide-react";

type Props = { quote: string; reportKind: string; verified: boolean | null };

/**
 * Renders one quote.
 * @param verified  true = found verbatim in the report; false = not found (not used by the analysis);
 *                  null = not in the loaded reports (shouldn't happen; shown as unchecked).
 */
export function Quote({ quote, reportKind, verified }: Props) {
  return (
    <figure className={`quote-block ${verified === false ? "quote-block--unverified" : ""}`}>
      <blockquote className="quote">“{quote}”</blockquote>
      <figcaption className="quote-block__meta small">
        {verified === true && (
          <span className="verified">
            <Check size={14} aria-hidden="true" /> verified in report
          </span>
        )}
        {verified === false && (
          <span className="unverified">
            <TriangleAlert size={14} aria-hidden="true" /> NOT found in report — not used
          </span>
        )}
        {verified === null && <span className="dim">not checked</span>}
        <span className="dim">· {reportKind} report</span>
      </figcaption>
    </figure>
  );
}
