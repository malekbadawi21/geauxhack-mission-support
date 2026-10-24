// extract.ts — sends one engineering report to Gemini and returns validated, structured data.
//
// This is the only file that talks to an external service (the Gemini API — our one allowed API).
// It runs on the server/CLI side only, because it reads the secret GEMINI_API_KEY from the
// environment; that's why tsconfig.app.json excludes it from the browser build.
//
// Anti-hallucination design: the LLM's job here is *reading*, not thinking. The system instruction
// tells Gemini to copy values and quotes exactly as written and never convert or infer. All math
// (unit conversion, forecasting, anomaly rules) happens later in plain TypeScript, where it is
// deterministic and testable. verify.ts then checks every quote Gemini returns against the report.

// GoogleGenAI is the client class from Google's official Gemini SDK.
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
// `type Extraction` imports only the TypeScript type (erased at runtime) — required by the
// `verbatimModuleSyntax` tsconfig setting. The `.ts` extension is allowed by `allowImportingTsExtensions`.
import { ExtractionSchema, type Extraction } from "./schema.ts";

// The "system instruction" is a standing set of rules Gemini follows for the whole request,
// separate from the report text itself. These rules are the prompt half of our anti-hallucination
// design; the code half is the schema below plus verify.ts.
const SYSTEM_INSTRUCTION = `You extract data from Mars Desert Research Station engineering reports.
Rules:
- Extract only what is written in the report. Never infer, estimate, or add information.
- For every reading and event, source_quote must be copied character-for-character from the report.
  Do not fix typos, reword, or join text from different places.
- raw_text is the value exactly as written (e.g. "¾", "40%", "15cm").
- value is the number as written: "¾" -> 0.75, "40%" -> 40, "15cm" -> 15. Never convert units.
  Use null if the value is not a number.
- measured_from is "top" or "bottom" only if the report explicitly says so; otherwise null.
- If you are unsure about any field, use null.
- questions_to_mission_support lists questions or requests the crew asks of Mission Support.`;

/**
 * Sends one report to Gemini and returns its structured, zod-validated extraction.
 * @param text  The full report text, exactly as saved in data/reports/.
 * @returns     An Extraction matching ExtractionSchema (quotes NOT yet verified — call verifyQuotes).
 * @throws      If env vars are missing, Gemini returns non-JSON, or the JSON doesn't fit the schema.
 * Why it exists: it isolates every LLM call in one place, so the rest of the code only ever sees
 * data that has already passed schema validation.
 */
export async function extractReport(text: string): Promise<Extraction> {
  // process.env holds environment variables (loaded from .env by the CLI, or set in Vercel later).
  // CLAUDE.md rule: never hardcode the key or the model name.
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) {
    throw new Error("GEMINI_API_KEY and GEMINI_MODEL must be set (see .env.example)");
  }

  const ai = new GoogleGenAI({ apiKey });
  // generateContent sends one request to Gemini and waits for the full reply.
  // `await` pauses this async function until the network call finishes.
  const response = await ai.models.generateContent({
    model,
    contents: text, // the report itself is the user message
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      // responseMimeType "application/json" switches Gemini into JSON mode: it must reply with
      // JSON only, no prose or markdown around it.
      responseMimeType: "application/json",
      // responseJsonSchema goes further: Gemini's output is constrained to this exact shape
      // (field names, enums, nullability). z.toJSONSchema converts our zod schema into the standard
      // JSON Schema format the API understands, so the two can never drift apart.
      responseJsonSchema: z.toJSONSchema(ExtractionSchema),
      temperature: 0, // we want the same answer every time, not creativity
    },
  });

  // response.text is the model's reply as one string. `?? ""` means "use an empty string if it's
  // undefined" (e.g. the reply was blocked), so JSON.parse below fails loudly instead of crashing oddly.
  const raw = response.text ?? "";
  // `unknown` (not `any`) forces us to validate before using the data — a TypeScript safety habit.
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Include the raw reply so we can see exactly what Gemini sent when debugging.
    throw new Error(`Gemini did not return valid JSON. Raw response:\n${raw}`);
  }

  // safeParse checks the data against the schema without throwing; it returns
  // { success: true, data } or { success: false, error }. Even with a response schema we re-check,
  // because the API constraint is a request to the model, not a guarantee.
  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Gemini response failed schema validation:\n${parsed.error.message}\nRaw response:\n${raw}`,
    );
  }
  return parsed.data; // fully typed as Extraction from here on
}
