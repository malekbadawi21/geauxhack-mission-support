// DailyReportPanel.tsx — the agent's daily report: status, concerns, crew actions, decisions for
// Earth, and the message to Earth as an outgoing transmission.
//
// How it fits: renders a DemoRun's report (src/lib/report-types.ts) for the as-of date — the recorded
// run in Replay mode, the API's answer in Live mode. Concerns link to their flags by id. The grounding
// badge shows our code's check (Phase 3b's grounding.ts) that every number in the text appears in the
// data; any number it couldn't trace is highlighted wherever it appears in the text.

import { Check, Radio, TriangleAlert } from "lucide-react";
import type { DemoRun } from "../lib/report-types.ts";
import { MESSAGE_TO_EARTH_MAX_WORDS, countWords } from "../lib/report-types.ts";
import type { CrewConfig } from "../lib/constants.ts";
import type { Flag } from "../lib/analyze.ts";
import { ONE_WAY_DELAY_MINUTES } from "../ui/config.ts";
import { longDate } from "../ui/format.ts";

type Props = {
  run: DemoRun | null; // the run for the as-of date, or null if there is none
  asOf: string;
  crew: CrewConfig;
  flags: Flag[]; // the current flags, so a concern can tell which of its ids exist
  onFlagClick: (id: string) => void;
};

/**
 * Wraps every occurrence of the given terms in <mark>, so ungrounded numbers stand out.
 * @param text   Report text.
 * @param terms  Strings to highlight (the grounding check's ungrounded numbers).
 */
function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  // Build one regex matching any term. The replace() escapes regex special characters so "1.5" means
  // the literal text "1.5". The capture group ( ) makes split() keep the matches in the result.
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "g"));
  // After split with a capture group, odd indexes are the matches.
  return <>{parts.map((part, i) => (i % 2 === 1 ? <mark key={i} className="ungrounded">{part}</mark> : part))}</>;
}

/** Renders the daily report section. */
export function DailyReportPanel({ run, asOf, crew, flags, onFlagClick }: Props) {
  if (!run) {
    return (
      <section className="section" id="report" aria-labelledby="report-title">
        <div className="section__head">
          <h2 id="report-title">Daily report</h2>
        </div>
        <p className="panel empty">
          No daily report for {longDate(asOf)}. The analysis above is current; the agent's report is generated when a day's
          reports are uploaded.
        </p>
      </section>
    );
  }

  const r = run.report;
  const bad = r.grounding.ungrounded;
  const ids = new Set(flags.map((f) => f.id));
  const words = countWords(r.message_to_earth);

  return (
    <section className="section" id="report" aria-labelledby="report-title">
      <div className="section__head">
        <h2 id="report-title">Daily report</h2>
        <p className="section__sub">
          {longDate(r.as_of)} · written by the agent from the analysis · {run.model}
        </p>
        <div className="section__badges">
          {run.is_sample && <span className="tag tag--warning">SAMPLE — HAND-WRITTEN PLACEHOLDER, NOT AN AGENT RUN</span>}
          {bad.length === 0 ? (
            <span className="tag tag--nominal">
              <Check size={13} aria-hidden="true" /> All {r.grounding.numbers_checked} numbers traced to source data
            </span>
          ) : (
            <span className="tag tag--critical">
              <TriangleAlert size={13} aria-hidden="true" /> {bad.length} of {r.grounding.numbers_checked} numbers not found in the data:{" "}
              {bad.join(", ")}
            </span>
          )}
        </div>
      </div>

      <div className="report">
        <div className="report__main">
          <div className="panel report__block">
            <h3 className="block-title">Concerns</h3>
            {r.concerns.length === 0 && <p className="dim">None.</p>}
            <ol className="concerns">
              {r.concerns.map((c, i) => (
                <li key={i} className="concern">
                  <div className="concern__title">{c.title}</div>
                  <p className="concern__detail">
                    <Highlight text={c.detail} terms={bad} />
                  </p>
                  <div className="concern__flags">
                    {c.flag_ids.map((id) =>
                      ids.has(id) ? (
                        <button key={id} className="flag-link mono" onClick={() => onFlagClick(id)}>
                          {id}
                        </button>
                      ) : (
                        // A cited flag that the current analysis doesn't have: say so instead of a dead link.
                        <span key={id} className="flag-link flag-link--missing mono" title="This flag id is not in the current analysis">
                          {id} (not found)
                        </span>
                      ),
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="report__pair">
            <div className="panel report__block">
              <h3 className="block-title">Crew actions now</h3>
              <ul className="bullets">
                {r.crew_actions.map((a, i) => (
                  <li key={i}>
                    <Highlight text={a} terms={bad} />
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel report__block report__block--decisions">
              <h3 className="block-title">Decisions for Earth</h3>
              <ol className="decisions">
                {r.decisions_for_earth.map((d, i) => (
                  <li key={i}>
                    <div className="decision__what">
                      <Highlight text={d.decision} terms={bad} />
                    </div>
                    <div className="decision__why dim">
                      <Highlight text={d.why} terms={bad} />
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        {/* The message to Earth, styled as an outgoing transmission. */}
        <article className="transmission" aria-label="Message to Earth">
          <header className="transmission__head mono">
            <span className="transmission__live">
              <Radio size={14} aria-hidden="true" /> OUTGOING TRANSMISSION
            </span>
            <span>
              FROM {crew.name.toUpperCase()} → MISSION SUPPORT, EARTH
            </span>
          </header>
          <p className="transmission__body">
            <Highlight text={r.message_to_earth} terms={bad} />
          </p>
          <footer className="transmission__foot small">
            <span className="mono">
              {words}/{MESSAGE_TO_EARTH_MAX_WORDS} words
            </span>
            <span className="dim">
              ~{ONE_WAY_DELAY_MINUTES} min one-way delay (simulated Mars distance): a reply takes 40+ minutes, so the message must
              stand on its own.
            </span>
          </footer>
        </article>
      </div>
    </section>
  );
}
