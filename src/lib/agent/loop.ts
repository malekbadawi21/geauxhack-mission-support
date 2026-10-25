// agent/loop.ts — runs the mission-support agent: Gemini investigates with tools, then submits a report.
//
// How it fits: api/daily-report.ts and scripts/daily-report.ts call runDailyReport(analysis). Gemini
// gets the tool declarations from tools.ts; each turn it asks for one or more tools, we run them
// (pure reads of the Analysis) and send the results back. It ends by calling submit_daily_report.
// Our code then validates the report (zod + real flag ids) and checks every number in it against the
// tool outputs (grounding.ts). The LLM writes the words; every number and alert comes from our code.
//
// Limits: at most MAX_TURNS free model turns, then one call that forces submit_daily_report. A report
// that fails validation gets exactly one retry, with the validation error sent back to Gemini.
//
// SERVER-ONLY: reads GEMINI_API_KEY / GEMINI_MODEL from process.env and the style guide from disk.
// Only scripts/ and api/ may import it (src/lib/agent/ is excluded from the browser build).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// Content = one message in the conversation (role + parts); FunctionCallingConfigMode = AUTO / ANY / ...
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type Content, type Part } from "@google/genai";
import type { Analysis } from "../analyze.ts";
import type { AgentTraceStep, DailyReport } from "../report-types.ts";
import { MESSAGE_TO_EARTH_MAX_WORDS, countWords } from "../report-types.ts";
import { checkGrounding } from "../grounding.ts";
import { SUBMIT_TOOL, SubmittedReportSchema, TOOL_DECLARATIONS, runTool, summarizeInput, summarizeOutput, type SubmittedReport } from "./tools.ts";

// Malek's limit: 5 model turns of free investigation, then one forced submit.
const MAX_TURNS = 5;

// Our choice: floors that reject placeholder text (a test run once submitted status_line "test").
// The style guide asks for 80–120 words; 40 is a hard floor well below that, not a style rule.
const MIN_MESSAGE_WORDS = 40;
const MIN_STATUS_LINE_WORDS = 3;

// Same retry policy as extract.ts: 429 rate limit, 503 overloaded, 504 deadline are temporary.
const RETRYABLE_STATUS = [429, 503, 504];
const RETRY_WAITS_MS = [2000, 4000, 8000];

// Where the message-to-Earth style guide lives (relative to the project root, which is the working
// directory for the CLI, `vercel dev` and the deployed function — vercel.json bundles data/style/).
const STYLE_GUIDE_PATH = join("data", "style", "ideal-message-2015-01-13.md");

const BASE_INSTRUCTION = `You are onboard mission support for the crew of an analog Mars habitat.
Each day you read the analysis of the crew's reports and write a short daily report.

How to work:
- Investigate with the tools before writing: start with get_overview, then look at the evidence for
  the important flags, the history of resources that are changing, and the water scenarios.
- Use ONLY numbers that appear in tool results. Never estimate, convert or calculate a new number.
  You may round (4.243 days -> "about 4.2 days"). If a number is not in a tool result, leave it out.
- Every concern lists the flag ids (exactly as given by get_overview) that back it up. Every
  critical flag must appear in a concern.
- Severity comes from the flags, not your judgment: overall is "critical" if any flag is critical,
  "caution" if any is a warning, otherwise "nominal" (our code enforces this).
- crew_actions: things the crew can do now without waiting for Earth.
- decisions_for_earth: only things that need human authority on Earth (resupply, approvals,
  procedures the crew asked for). Each has a one-sentence why.
- message_to_earth is read on its own by Mission Control: self-contained, at most
  ${MESSAGE_TO_EARTH_MAX_WORDS} words, because each reply takes 20+ minutes each way from Mars. No markdown.
- You have at most ${MAX_TURNS} turns. Ask for several tools at once (in parallel) to save turns.
- Finish by calling ${SUBMIT_TOOL} exactly once, with the complete report. Do not reply with plain text.`;

/**
 * The full system instruction: our rules, plus the style guide's rules if the file exists.
 * Why it exists: the style guide is Malek's structure/tone/length rules for the message to Earth.
 * It is included as rules to follow, never as content (it contains no facts).
 */
function systemInstruction(): string {
  const path = join(process.cwd(), STYLE_GUIDE_PATH); // process.cwd() = the folder the process started in
  if (!existsSync(path)) return BASE_INSTRUCTION;
  const guide = readFileSync(path, "utf8");
  return `${BASE_INSTRUCTION}\n\nRules for message_to_earth (follow them; take no facts from them):\n\n${guide}`;
}

/** Waits `ms` milliseconds (see extract.ts). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The report's overall status, decided by our flags (never by Gemini): any critical flag → "critical",
 * any warning → "caution", else "nominal".
 */
export function overallFromFlags(flags: Analysis["flags"]): SubmittedReport["overall"] {
  if (flags.some((f) => f.severity === "critical")) return "critical";
  if (flags.some((f) => f.severity === "warning")) return "caution";
  return "nominal";
}

/**
 * Checks a submitted report: zod schema (types, enums, 120-word limit), no placeholder text, flag ids real,
 * and every critical flag covered by a concern.
 * @param args      Gemini's submit_daily_report arguments (unchecked JSON).
 * @param analysis  The analysis the report is about: its date and overall status overwrite the
 *                  model's, and its flags are what the concerns must point at.
 * @returns         { report } if valid, or { error } with a message Gemini can act on.
 * Why the extra checks: the contract allows "" and [], and test runs submitted blank and "test" reports.
 */
export function validateSubmission(
  args: Record<string, unknown>,
  analysis: Analysis,
): { report: SubmittedReport; error?: undefined } | { report?: undefined; error: string } {
  // The date and overall status are ours, not the model's: `{ ...args, x }` replaces them before validation.
  const parsed = SubmittedReportSchema.safeParse({ ...args, as_of: analysis.asOf, overall: overallFromFlags(analysis.flags) });
  if (!parsed.success) return { error: parsed.error.message };
  const r = parsed.data;
  const problems: string[] = [];
  if (countWords(r.status_line) < MIN_STATUS_LINE_WORDS) problems.push(`status_line needs at least ${MIN_STATUS_LINE_WORDS} words`);
  const words = countWords(r.message_to_earth);
  if (words < MIN_MESSAGE_WORDS) problems.push(`message_to_earth has ${words} words; write 80–${MESSAGE_TO_EARTH_MAX_WORDS}`);
  const flagIds = analysis.flags.map((f) => f.id);
  const used = r.concerns.flatMap((c) => c.flag_ids);
  const unknown = used.filter((id) => !flagIds.includes(id));
  if (unknown.length > 0) problems.push(`unknown flag ids: ${unknown.join(", ")} (use ids exactly as given by get_overview)`);
  const uncovered = analysis.flags.filter((f) => f.severity === "critical" && !used.includes(f.id)).map((f) => f.id);
  if (uncovered.length > 0) problems.push(`critical flags not covered by any concern: ${uncovered.join(", ")}`);
  return problems.length > 0 ? { error: problems.join("; ") } : { report: r };
}

export type AgentRun = {
  report: SubmittedReport; // the validated report, before grounding is attached
  trace: AgentTraceStep[];
  toolOutputs: unknown[]; // every tool result Gemini received, for grounding.ts
  model: string;
};

/**
 * Runs the agent on one Analysis.
 * @returns  The validated report, the trace (one step per tool call) and the tool outputs.
 * @throws   If env vars are missing, Gemini fails after retries, or no valid report arrives.
 */
export async function runAgent(analysis: Analysis): Promise<AgentRun> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  if (!apiKey || !model) throw new Error("GEMINI_API_KEY and GEMINI_MODEL must be set (see .env.example)");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 60_000 } });
  const instruction = systemInstruction();

  // The conversation so far. Gemini is stateless: every call sends the whole history.
  const contents: Content[] = [
    { role: "user", parts: [{ text: `Write the daily report for ${analysis.crew.name} as of ${analysis.asOf}.` }] },
  ];
  const trace: AgentTraceStep[] = [];
  const toolOutputs: unknown[] = [];

  /** One model call, with retries on temporary errors. `forced` makes submit_daily_report the only option. */
  const callModel = async (forced: boolean) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: instruction,
            tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
            // AUTO = the model chooses tools or text; ANY + allowedFunctionNames = it must call that one.
            toolConfig: {
              functionCallingConfig: forced
                ? { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [SUBMIT_TOOL] }
                : { mode: FunctionCallingConfigMode.AUTO },
            },
            // No temperature override: Google recommends the default for Gemini 3 models (lower can cause
            // looping). Determinism doesn't matter much here — the demo replays a saved run.
          },
        });
      } catch (err) {
        const retryable = err instanceof ApiError && RETRYABLE_STATUS.includes(err.status);
        if (!retryable || attempt >= RETRY_WAITS_MS.length) throw err;
        console.warn(`Gemini returned ${err.status}; retry ${attempt + 1}/${RETRY_WAITS_MS.length}`);
        await sleep(RETRY_WAITS_MS[attempt]);
      }
    }
  };

  let maxCalls = MAX_TURNS + 1; // 5 free turns + 1 forced submit
  let retried = false; // the one validation retry has been used
  for (let call = 1; call <= maxCalls; call++) {
    const forced = call > MAX_TURNS;
    const response = await callModel(forced);
    const modelTurn = response.candidates?.[0]?.content;
    if (!modelTurn) throw new Error(`Gemini returned no content (finish reason: ${response.candidates?.[0]?.finishReason ?? "none"})`);
    // Send the model's turn back unchanged: it carries "thought signatures" Gemini 3 needs to continue.
    contents.push(modelTurn);

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) {
      // Plain text instead of a tool call: remind it, and let the next turn (or the forced call) fix it.
      contents.push({ role: "user", parts: [{ text: `Use the tools, then call ${SUBMIT_TOOL}. Do not reply with plain text.` }] });
      continue;
    }

    const replies: Part[] = []; // one functionResponse per call, all sent back together in one turn
    for (const fc of calls) {
      const name = fc.name ?? "";
      const args = fc.args ?? {};
      const started = Date.now();

      if (name === SUBMIT_TOOL) {
        const result = validateSubmission(args, analysis);
        trace.push({
          step: trace.length + 1, tool: name, input_summary: result.report ? `overall ${result.report.overall}, ${result.report.concerns.length} concerns` : "invalid report",
          output_summary: result.report ? "report accepted" : `rejected: ${result.error.slice(0, 140)}`, ms: Date.now() - started,
        });
        if (result.report) return { report: result.report, trace, toolOutputs, model };
        if (retried) throw new Error(`Agent's report failed validation twice: ${result.error}`);
        retried = true;
        if (forced) maxCalls++; // the retry needs one more forced call
        replies.push({ functionResponse: { id: fc.id, name, response: { error: `Report rejected. Fix and resubmit: ${result.error}` } } });
        continue;
      }

      const output = runTool(analysis, name, args);
      toolOutputs.push(output);
      trace.push({ step: trace.length + 1, tool: name, input_summary: summarizeInput(args), output_summary: summarizeOutput(name, output), ms: Date.now() - started });
      // The SDK docs: put the result under "output" (or "error") in a function response.
      replies.push({ functionResponse: { id: fc.id, name, response: { output } } });
    }
    // If the next call will be the forced one, say so in words. Without this, Gemini answered the forced
    // call with an empty stub report ("", [], "test") every time we tested it.
    if (call + 1 > MAX_TURNS) {
      replies.push({ text: `You have used all your turns. Call ${SUBMIT_TOOL} now with the complete report, written from the tool results above.` });
    }
    contents.push({ role: "user", parts: replies });
  }
  throw new Error(`Agent did not submit a valid report within ${maxCalls} model calls`);
}

/**
 * The whole daily-report pipeline after analysis: run the agent, then attach our grounding check.
 * Why it exists: the API and the CLI must produce the report the same way.
 */
export async function runDailyReport(analysis: Analysis): Promise<{ report: DailyReport; trace: AgentTraceStep[]; model: string }> {
  const run = await runAgent(analysis);
  const grounding = checkGrounding(run.report, run.toolOutputs);
  return { report: { ...run.report, grounding }, trace: run.trace, model: run.model };
}
