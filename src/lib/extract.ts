// extract.ts — sends one engineering report to Gemini and returns validated, structured data.
//
// This is the only file that talks to an external service (the Gemini API — our one allowed API).
// SERVER-ONLY: it reads the secret GEMINI_API_KEY from process.env, so it must never be imported by
// UI code (only scripts/ and api/ may import it). tsconfig.app.json excludes it from the browser
// build, and it is the one file in src/lib/ allowed to touch `process`.
//
// Anti-hallucination design: the LLM's job here is *reading*, not thinking. The system instruction
// tells Gemini to copy values and quotes exactly as written and never convert or infer. All math
// (unit conversion, forecasting, anomaly rules) happens later in plain TypeScript, where it is
// deterministic and testable. verify.ts then checks every quote Gemini returns against the report.

// GoogleGenAI is the client class from Google's official Gemini SDK.
import { z } from "zod";
// ApiError is the SDK's error class for HTTP failures; its `.status` tells us 429 vs 503 vs others.
import { ApiError, GoogleGenAI } from "@google/genai";
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
- approximate is true only when the text marks the value as approximate (e.g. "~", "about",
  "approximately", "around", "roughly", "estimated"); otherwise false.
- Use resource "water_total" for a total amount of water the crew says is available (e.g. "~360l"),
  not for a single tank's level.
- If you are unsure about any field, use null.
- questions_to_mission_support lists questions or requests the crew asks of Mission Support. text is
  the question; source_quote is the exact sentence(s) from the report where the crew asks it.`;

// HTTP 429 = rate limited, 503 = model overloaded, 504 = Gemini's own deadline expired. All are
// temporary, so waiting and retrying usually works. (504 was added after we saw it in a batch run.)
// Any other error (bad key, bad request) would fail again, so we don't retry those.
const RETRYABLE_STATUS = [429, 503, 504];
const RETRY_WAITS_MS = [2000, 4000, 8000]; // one wait per retry: up to 3 retries after the first call

/**
 * Returns a promise that resolves after `ms` milliseconds.
 * Why it exists: `await sleep(2000)` pauses an async function without blocking Node.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  // httpOptions.timeout (ms) aborts a request that hangs, so a dead network shows up as an error
  // instead of a script that silently waits forever. 60s is our choice: normal calls take 10–30s.
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } });
  // Retry loop: attempt 0 is the first call; attempts 1..3 happen after waiting 2s, 4s, 8s.
  // `let` because the loop assigns it; the type says it may still be undefined before the first call.
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (let attempt = 0; response === undefined; attempt++) {
    try {
      // generateContent sends one request to Gemini and waits for the full reply.
      // `await` pauses this async function until the network call finishes.
      response = await ai.models.generateContent({
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
    } catch (err) {
      // `instanceof ApiError` narrows `err` (type unknown) so TypeScript lets us read `.status`.
      const retryable = err instanceof ApiError && RETRYABLE_STATUS.includes(err.status);
      if (!retryable || attempt >= RETRY_WAITS_MS.length) throw err; // give up: not temporary, or out of retries
      const wait = RETRY_WAITS_MS[attempt];
      console.warn(`Gemini returned ${err.status}; retry ${attempt + 1}/${RETRY_WAITS_MS.length} in ${wait / 1000}s`);
      await sleep(wait);
    }
  }

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
