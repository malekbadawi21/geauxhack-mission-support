// schema.ts — the single definition of what an "extraction" looks like.
//
// Gemini reads an engineering report and returns JSON in this shape. We use the schema three ways:
//   1. extract.ts converts it to JSON Schema and sends it to Gemini, so Gemini's output is
//      constrained to these fields and allowed values.
//   2. extract.ts validates Gemini's reply against it at runtime (never trust an LLM's JSON blindly).
//   3. The TypeScript types at the bottom are derived from it, so the rest of the code is type-checked.
// Because all three come from the same object, they can never drift apart.
//
// Anti-hallucination design: every Reading, Event and Question carries a `source_quote` copied from
// the report. verify.ts later checks that quote really appears in the report. `raw_text` keeps the
// value exactly as written so our own code (not the LLM) does any unit conversion later.
//
// The second half of the file describes the *saved* form (data/extractions/*.json): the extraction
// plus `verified` flags and a normalized date. scripts/ validate saved files against it on load.

// zod is a validation library: you describe a shape once, then it can check unknown data against it.
import { z } from "zod";

// One measured resource level, copied exactly as the crew wrote it.
// z.object({...}) describes a JSON object; each key's value says what type that field must be.
export const ReadingSchema = z.object({
  // z.enum([...]) means "must be exactly one of these strings". Unknown tanks go in "other"
  // rather than letting Gemini invent new categories.
  resource: z.enum([
    "diesel",
    "propane",
    "water_static",
    "water_loft",
    "water_trailer",
    "gasoline",
    "other",
  ]),
  raw_text: z.string(), // the value exactly as written, e.g. "¾", "15cm"
  // .nullable() allows null. We prefer null over a guessed number: missing data must stay missing.
  value: z.number().nullable(), // number as written; "¾" -> 0.75; null if not numeric
  unit: z.enum(["percent", "fraction", "cm", "in", "gal", "L", "other"]).nullable(),
  // Whether a tank depth is measured from the top or bottom changes its meaning completely,
  // so we only record it when the report says so; otherwise null (no guessing).
  measured_from: z.enum(["top", "bottom"]).nullable(), // only if the report says so
  source_quote: z.string(), // verbatim span from the report containing this reading
});

// Something that happened: resupply issues, leaks, failures.
export const EventSchema = z.object({
  type: z.enum(["resupply_issue", "leak", "equipment_failure", "other"]),
  description: z.string(), // Gemini's short summary; the quote below is what we actually trust
  source_quote: z.string(), // verbatim span from the report, checked by verify.ts
});

// A question or request the crew sends to Mission Support. An object (not a bare string) so it
// carries a source_quote and can be verified like everything else.
export const QuestionSchema = z.object({
  text: z.string(), // the question as Gemini summarizes it
  source_quote: z.string(), // verbatim span from the report, checked by verify.ts
});

// Everything Gemini pulls out of one engineering report.
export const ExtractionSchema = z.object({
  report_date: z.string().nullable(), // as written in the report; dates.ts normalizes it
  crew: z.string().nullable(),
  author: z.string().nullable(),
  readings: z.array(ReadingSchema), // z.array(X) means "a list where every item matches X"
  events: z.array(EventSchema),
  questions_to_mission_support: z.array(QuestionSchema),
});

// --- Saved form -----------------------------------------------------------------------------
// .extend({...}) makes a new schema with every field of the original plus (or overriding) these.
// `verified` is set by verify.ts, never by Gemini.
const verifiedFlag = { verified: z.boolean() };
export const VerifiedReadingSchema = ReadingSchema.extend(verifiedFlag);
export const VerifiedEventSchema = EventSchema.extend(verifiedFlag);
export const VerifiedQuestionSchema = QuestionSchema.extend(verifiedFlag);

// The output of verifyQuotes(): same extraction, with every item's verification result attached.
export const VerifiedExtractionSchema = ExtractionSchema.extend({
  readings: z.array(VerifiedReadingSchema),
  events: z.array(VerifiedEventSchema),
  questions_to_mission_support: z.array(VerifiedQuestionSchema),
});

// What we write to data/extractions/<report>.json and what analyzeCrew() consumes.
export const SavedExtractionSchema = VerifiedExtractionSchema.extend({
  date: z.string(), // YYYY-MM-DD, normalized by dates.ts (the date the analysis sorts by)
  date_from_filename: z.boolean(), // true if report_date was missing/unparseable and we used the filename
  source_file: z.string(), // the report filename this came from, e.g. "2015-01-13-engineering.txt"
});

// z.infer<typeof X> is a type trick: it turns a zod schema (a runtime value) into the matching
// TypeScript type at compile time, so we never write the same shape twice by hand.
export type Reading = z.infer<typeof ReadingSchema>;
// Named ReportEvent (not Event) so it doesn't collide with the browser's built-in Event type.
export type ReportEvent = z.infer<typeof EventSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
export type VerifiedReading = z.infer<typeof VerifiedReadingSchema>;
export type VerifiedEvent = z.infer<typeof VerifiedEventSchema>;
export type VerifiedQuestion = z.infer<typeof VerifiedQuestionSchema>;
export type VerifiedExtraction = z.infer<typeof VerifiedExtractionSchema>;
export type SavedExtraction = z.infer<typeof SavedExtractionSchema>;
// Indexed access type: Reading["resource"] is the union of the enum strings ("diesel" | ...).
export type Resource = Reading["resource"];
