// App.tsx — the dashboard's root: holds the app state and runs the upload pipeline.
//
// How it fits: main.tsx renders this into index.html. The state is small:
//   - received: the saved extractions loaded so far (the preloaded history, plus uploads),
//   - asOf: the day being viewed (chosen in the scrubber),
//   - runs: the agent's daily reports by as-of date (recorded in Replay, from the API in Live),
//   - mode, the upload dialog, the pipeline panel, and which flag rows are open.
// Everything the page shows is derived from analyzeCrew(received, asOf, CREW_147), re-run whenever
// the day or the data changes — the same function the CLI and the agent use (CLAUDE.md rule), so the
// dashboard can never disagree with them. Reports dated after asOf are ignored by analyzeCrew.

import { useMemo, useRef, useState } from "react";
import { analyzeCrew } from "./lib/analyze.ts";
import { CREW_147 } from "./lib/constants.ts";
import type { SavedExtraction } from "./lib/schema.ts";
import type { DemoRun } from "./lib/report-types.ts";
import { ALL_EXTRACTIONS, DEMO_RUNS, MANIFEST, PRELOADED, quoteCounts, savedExtractionFor } from "./ui/data.ts";
import { LIVE_TRACE_STEP_MS, REPLAY_MS } from "./ui/config.ts";
import { liveDailyReport, liveExtract, sleep, type Mode, type PipelineState, type UploadFile } from "./ui/pipeline.ts";
import { flagAnchor, longDate } from "./ui/format.ts";
import { Header } from "./components/Header.tsx";
import { StatusStrip } from "./components/StatusStrip.tsx";
import { ResourceCards } from "./components/ResourceCards.tsx";
import { HeroSection } from "./components/HeroSection.tsx";
import { FlagsList } from "./components/FlagsList.tsx";
import { DailyReportPanel } from "./components/DailyReportPanel.tsx";
import { AgentTrace } from "./components/AgentTrace.tsx";
import { UploadPanel } from "./components/UploadPanel.tsx";
import { PipelinePanel } from "./components/PipelinePanel.tsx";

/** Adds new extractions to a list, replacing any with the same source file (a re-upload wins). */
function mergeExtractions(list: SavedExtraction[], added: SavedExtraction[]): SavedExtraction[] {
  const names = new Set(added.map((x) => x.source_file));
  return [...list.filter((x) => !names.has(x.source_file)), ...added];
}

/** Short summary of what one extraction contains, for the "Reading reports" stage. */
function extractedNote(x: SavedExtraction): string {
  return `${x.readings.length} readings, ${x.events.length} events, ${x.questions_to_mission_support.length} questions extracted`;
}

/** Short summary of its quote check, for the "Verifying quotes" stage. */
function verifiedNote(x: SavedExtraction): string {
  const { verified, total } = quoteCounts(x);
  return `${verified}/${total} quotes found verbatim in the report${verified < total ? ` — ${total - verified} flagged, not used` : ""}`;
}

/** True when the viewer asked the OS for less motion; scrolling then jumps instead of gliding. */
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The dashboard. No props; returns the whole page. */
function App() {
  const [mode, setMode] = useState<Mode>("replay"); // Replay is the default so the demo never depends on Gemini
  const [received, setReceived] = useState<SavedExtraction[]>(PRELOADED);
  const [asOf, setAsOf] = useState(MANIFEST.preload_through);
  const [runs, setRuns] = useState<Record<string, DemoRun>>({});
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [openFlags, setOpenFlags] = useState<Set<string>>(new Set());
  // useRef keeps a value across renders without re-rendering. runId lets a newer pipeline run tell an
  // older one (still sleeping) to stop; lastUpload is kept so "Switch to replay" can redo the same files.
  const runId = useRef(0);
  const lastUpload = useRef<UploadFile[]>([]);

  // useMemo re-runs analyzeCrew only when the data or the day changes, not on every render.
  const analysis = useMemo(() => analyzeCrew(received, asOf, CREW_147), [received, asOf]);
  const dates = useMemo(() => [...new Set(received.map((x) => x.date))].sort(), [received]);
  const run = runs[asOf] ?? null; // the daily report for the day on screen, if any
  const busy = pipeline !== null && pipeline.stage !== "ready" && pipeline.error === null;

  // Recorded days not loaded yet (Replay only): lets the scrubber reach the rest of the mission.
  const notLoaded = ALL_EXTRACTIONS.filter((x) => !received.some((r) => r.source_file === x.source_file));
  const moreDays = mode === "replay" && notLoaded.length > 0 ? { count: notLoaded.length, through: notLoaded.at(-1)!.date } : null;

  /** Updates part of the pipeline state, but only if run `id` is still the current one. */
  const patch = (id: number, p: Partial<PipelineState>) => {
    if (runId.current === id) setPipeline((s) => (s ? { ...s, ...p } : s));
  };

  /**
   * Runs the upload pipeline for these files in the given mode.
   * Replay: everything comes from saved files and is paced with REPLAY_MS.
   * Live: each file goes to /api/extract, then all loaded extractions go to /api/daily-report.
   */
  async function runPipeline(files: UploadFile[], runMode: Mode) {
    const id = ++runId.current;
    const alive = () => runId.current === id; // false once a newer run has started
    lastUpload.current = files;
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    const notes: Record<string, string> = {};
    setPipeline({ mode: runMode, files: files.map((f) => f.name), stage: "reading", fileNotes: {}, analysisNote: null, run: null, traceShown: 0, note: null, error: null });

    try {
      // 1. Reading reports (Live: extraction by Gemini through our API; Replay: saved extraction).
      const extracted: SavedExtraction[] = [];
      for (const f of files) {
        let x: SavedExtraction;
        if (runMode === "live") {
          x = await liveExtract(f.name, await f.readText());
        } else {
          await sleep(REPLAY_MS.readPerFile);
          x = savedExtractionFor(f.name)!; // `!`: replay files were checked by name before starting
        }
        if (!alive()) return;
        extracted.push(x);
        notes[f.name] = extractedNote(x);
        patch(id, { fileNotes: { ...notes } });
      }

      // 2. Verifying quotes: verify.ts already ran on the server (or when the file was saved);
      //    this stage shows its result per file.
      patch(id, { stage: "verifying" });
      await sleep(runMode === "replay" ? REPLAY_MS.verify : 300);
      if (!alive()) return;
      files.forEach((f, i) => (notes[f.name] = verifiedNote(extracted[i])));
      patch(id, { fileNotes: { ...notes } });

      // 3. Updating analysis: add the new reports and jump to their day.
      patch(id, { stage: "analyzing" });
      const day = extracted.map((x) => x.date).sort().at(-1)!; // the newest uploaded date
      const merged = mergeExtractions(received, extracted);
      setReceived(merged);
      setAsOf(day);
      const updated = analyzeCrew(merged, day, CREW_147); // same call the page makes, for the summary line
      const crit = updated.flags.filter((f) => f.severity === "critical").length;
      await sleep(runMode === "replay" ? REPLAY_MS.analyze : 200);
      if (!alive()) return;
      patch(id, { analysisNote: `Analysis as of ${longDate(day)}: ${updated.flags.length} flags (${crit} critical), ${updated.series.length} resources tracked.` });

      // 4. Agent investigating.
      patch(id, { stage: "agent" });
      const agentRun = runMode === "live" ? await liveDailyReport(merged, day) : (DEMO_RUNS[day] ?? null);
      if (!alive()) return;
      if (!agentRun) {
        // Replay only has recorded runs for some days; say so instead of inventing a report.
        patch(id, { stage: "ready", note: `No recorded agent run for ${longDate(day)}. The analysis is updated; there is no daily report for this day in replay.` });
        return;
      }
      patch(id, { run: agentRun });
      for (let i = 1; i <= agentRun.trace.length; i++) {
        await sleep(runMode === "replay" ? REPLAY_MS.traceStep : LIVE_TRACE_STEP_MS);
        if (!alive()) return;
        patch(id, { traceShown: i });
      }
      await sleep(REPLAY_MS.finish);
      if (!alive()) return;

      // 5. Daily report ready.
      setRuns((r) => ({ ...r, [day]: agentRun }));
      patch(id, { stage: "ready" });
    } catch (e) {
      // Only Live calls can throw here; show the message as is.
      patch(id, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * Called by the upload dialog. Replay mode only knows the recorded reports, so unknown names are
   * refused with a message (the dialog stays open). Returns null when the pipeline starts.
   */
  function handleUpload(files: UploadFile[]): string | null {
    if (mode === "replay") {
      const unknown = files.filter((f) => !savedExtractionFor(f.name));
      if (unknown.length > 0) {
        return `Replay mode only knows the recorded reports (e.g. ${MANIFEST.upload_files.join(", ")}). Not recognized: ${unknown.map((f) => f.name).join(", ")}. Switch to Live to extract a new report.`;
      }
    }
    setUploadOpen(false);
    void runPipeline(files, mode); // `void`: we don't await here; the pipeline updates state as it goes
    return null;
  }

  /** "Switch to replay" after a Live error: change mode and replay the same files if they're recorded. */
  function switchToReplay() {
    setMode("replay");
    const files = lastUpload.current;
    if (files.length > 0 && files.every((f) => savedExtractionFor(f.name))) void runPipeline(files, "replay");
    else setPipeline(null);
  }

  /** Opens a flag row and scrolls to it (used by the daily report's concern links). */
  function showFlag(id: string) {
    setOpenFlags((s) => new Set(s).add(id));
    // requestAnimationFrame waits for React to render the opened row before scrolling to it.
    requestAnimationFrame(() =>
      document.getElementById(flagAnchor(id))?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "center" }),
    );
  }

  /** Expands or collapses one flag row. */
  function toggleFlag(id: string) {
    setOpenFlags((s) => {
      const next = new Set(s); // copy: React state must be replaced, not changed in place
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <>
      <Header
        crewName={CREW_147.name}
        asOf={asOf}
        mode={mode}
        busy={busy}
        onMode={(m) => {
          setMode(m);
          setPipeline(null);
        }}
        onUpload={() => setUploadOpen(true)}
        dates={dates}
        onDate={(d) => {
          setAsOf(d);
          if (!busy) setPipeline(null); // a finished pipeline panel is about another day: put it away
        }}
        moreDays={moreDays}
        onLoadMore={() => setReceived((r) => mergeExtractions(r, notLoaded))}
      />
      <main className="page">
        {pipeline && (
          <PipelinePanel
            state={pipeline}
            onClose={() => setPipeline(null)}
            onSwitchToReplay={switchToReplay}
            onViewReport={() => document.getElementById("report")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" })}
          />
        )}
        <StatusStrip analysis={analysis} report={run?.report ?? null} />
        <ResourceCards analysis={analysis} />
        <HeroSection analysis={analysis} startDate={dates[0] ?? asOf} />
        <FlagsList flags={analysis.flags} received={received} open={openFlags} onToggle={toggleFlag} />
        <DailyReportPanel run={run} asOf={asOf} crew={CREW_147} flags={analysis.flags} onFlagClick={showFlag} />
        <AgentTrace steps={run?.trace ?? null} model={run?.model ?? null} />
        <footer className="page__foot small dim">
          Data: MDRS Crew 147 engineering and commander reports, January 2015 (bundled). Readings extracted by Gemini, every quote
          checked against the report text; all forecasts and flags computed by deterministic code.
        </footer>
      </main>
      {uploadOpen && <UploadPanel mode={mode} onClose={() => setUploadOpen(false)} onSubmit={handleUpload} />}
    </>
  );
}

export default App;
