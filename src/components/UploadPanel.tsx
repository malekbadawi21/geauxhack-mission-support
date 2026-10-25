// UploadPanel.tsx — the upload dialog: drop report files, pick them, or use the two demo files.
//
// How it fits: hands a list of UploadFile to App.tsx, which runs the pipeline. In Replay mode the
// files are recognized by filename (their content is never read); App returns an error message if a
// name isn't one of the recorded reports, and this panel shows it. In Live mode the text is sent to
// /api/extract. The "use demo files" button reads the bundled Jan 13 reports from data/reports/.

import { useState, type DragEvent } from "react";
import { FileText, X } from "lucide-react";
import { MANIFEST, bundledReportText } from "../ui/data.ts";
import type { Mode, UploadFile } from "../ui/pipeline.ts";
import { longDate } from "../ui/format.ts";

type Props = {
  mode: Mode;
  onClose: () => void;
  onSubmit: (files: UploadFile[]) => string | null; // returns an error message, or null if accepted
};

/** Wraps a browser File so its text is only read if someone asks for it. */
const fromFile = (f: File): UploadFile => ({ name: f.name, readText: () => f.text() });

/** Wraps a bundled demo report the same way. */
const fromBundle = (name: string): UploadFile => ({
  name,
  readText: async () => {
    const text = await bundledReportText(name);
    if (text === null) throw new Error(`bundled report ${name} not found`);
    return text;
  },
});

/** Renders the dialog. */
export function UploadPanel({ mode, onClose, onSubmit }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Passes files to App; keeps the dialog open with the message if they were rejected. */
  const submit = (files: UploadFile[]) => {
    if (files.length === 0) return;
    setError(onSubmit(files));
  };

  /** Drop handler: preventDefault stops the browser from opening the file itself. */
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    submit([...e.dataTransfer.files].map(fromFile)); // [...FileList] turns it into a normal array
  };

  return (
    // Clicking the dimmed backdrop closes the dialog; clicks inside the card don't (stopPropagation).
    <div className="overlay" onClick={onClose}>
      <div className="dialog panel" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(e) => e.stopPropagation()}>
        <header className="dialog__head">
          <h2 id="upload-title">Upload daily reports</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <p className="dim small">
          {mode === "replay"
            ? "Replay mode: files are matched by name to the recorded reports and their saved extractions; nothing is sent anywhere."
            : "Live mode: each file's text is sent to our /api/extract (Gemini), then the agent writes the daily report."}
        </p>

        {/* onDragOver must preventDefault, or the browser refuses the drop. */}
        <label
          className={`dropzone ${dragging ? "dropzone--over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <FileText size={28} aria-hidden="true" />
          <span>Drop engineering / commander report .txt files here</span>
          <span className="dim small">or click to choose files</span>
          <input type="file" accept=".txt,text/plain" multiple hidden onChange={(e) => submit([...(e.target.files ?? [])].map(fromFile))} />
        </label>

        <div className="dialog__demo">
          <div>
            <div className="small">Demo: {longDate(MANIFEST.upload_day)} reports</div>
            <div className="mono dim small">{MANIFEST.upload_files.join(" + ")}</div>
          </div>
          <button className="btn btn--primary" onClick={() => submit(MANIFEST.upload_files.map(fromBundle))}>
            Use demo files
          </button>
        </div>

        {error && (
          <p className="dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
