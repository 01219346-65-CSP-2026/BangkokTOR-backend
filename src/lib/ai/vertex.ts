import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import type { GradeInput, Grader, RuleFinding, RuleSpec, Summarizer } from "./types.ts";

// ============================================================================
// Google Vertex AI (Gemini) — YOU write this file (feat/91). See LEARNING.md.
// ============================================================================
//
// Three layers, top to bottom:
//
//   1. callGemini()            the ONLY function that talks to Google.
//                              Prompt + JSON schema in, parsed JSON out.
//   2. gradeSchema()           pure helpers: the question we ask and how we
//      buildGradePrompt()      check the answer. No network — tested directly.
//      keepVerifiedFindings()
//   3. createVertexGrader()    glues 1 and 2 into a `Grader` (types.ts).
//
// The spec is src/lib/ai/vertex.test.ts:
//     bun test src/lib/ai/vertex.test.ts
//
// AUTH: a Vertex "express mode" API key (VERTEX_API_KEY in .env), sent in the
// URL as ?key=... — no service account, no Google SDK, just `fetch`.
// ============================================================================

// ---------------------------------------------------------------------------
// 1. Talking to Gemini
// ---------------------------------------------------------------------------

/** The express-mode endpoint. The full URL is
 *  `${VERTEX_BASE}/${model}:generateContent?key=${apiKey}` */
export const VERTEX_BASE = "https://aiplatform.googleapis.com/v1/publishers/google/models";

export type GeminiRequest = {
  prompt: string;
  /** JSON schema (OpenAPI style: "OBJECT", "STRING", ...). Gemini is forced
   *  to answer in exactly this shape. */
  schema: Record<string, unknown>;
  signal?: AbortSignal;
};

/**
 * Send one prompt to Gemini, return the parsed JSON answer.
 *
 * Request body Gemini expects:
 *   {
 *     contents: [{ role: "user", parts: [{ text: <prompt> }] }],
 *     generationConfig: {
 *       temperature: 0,                          // repeatable answers
 *       responseMimeType: "application/json",
 *       responseSchema: <schema>,
 *     }
 *   }
 *
 * Reply you get back (the parts that matter):
 *   {
 *     candidates: [{ content: { parts: [{ text: "<JSON as a string>" }] },
 *                    finishReason: "STOP" }],
 *     promptFeedback?: { blockReason?: "SAFETY" }
 *   }
 *
 * Throw an Error when: the key is missing (before calling fetch), the HTTP
 * status is not ok, the prompt was blocked, finishReason is not "STOP", or the
 * text is not valid JSON. Never put the URL in an error — it contains the key.
 */
export async function callGemini<T = unknown>(req: GeminiRequest): Promise<T> {
  throw new Error("TODO(feat/91): callGemini — see LEARNING.md step 4");
}

/** Throw a clear error mentioning VERTEX_API_KEY when env.vertexApiKey is empty. */
export function assertVertexConfig(): void {
  throw new Error("TODO(feat/91): assertVertexConfig — see LEARNING.md step 4");
}

// ---------------------------------------------------------------------------
// 2. Grading helpers (pure)
// ---------------------------------------------------------------------------

/**
 * The answer shape we force on Gemini:
 *   { findings: [{ code, present, quote }] }
 * `code` is an enum of `codes`, so the model cannot invent a rule, and `quote`
 * has maxLength MAX_EVIDENCE_CHARS. Types are written "OBJECT", "ARRAY",
 * "STRING", "BOOLEAN".
 */
export function gradeSchema(codes: string[]): Record<string, unknown> {
  throw new Error("TODO(feat/91): gradeSchema — see LEARNING.md step 5");
}

/**
 * The question: "for each rule, does the document contain such a clause? If
 * so, quote it word-for-word." Must include, for every rule, its code in
 * [BRACKETS], its definition, its unfairWhen (if any) and its cue words; the
 * words WORD-FOR-WORD and the MAX_EVIDENCE_CHARS limit; and the whole text.
 */
export function buildGradePrompt(rules: RuleSpec[], text: string): string {
  throw new Error("TODO(feat/91): buildGradePrompt — see LEARNING.md step 5");
}

/**
 * Turn Gemini's raw answer into findings we are willing to store. Gemini is
 * NOT trusted. One finding per rule in `rules` (in that order):
 *   - no answer for the rule                    → fired false, checked false
 *   - present=false                             → fired false, checked true
 *   - present=true, quote NOT in the text       → fired false, checked false
 *   - present=true, quote in the text           → fired true, checked true,
 *       evidence = quote, filename = the PDF it came from
 * Use isVerbatim (types.ts), locateQuote (types.ts) and fileAt (fulltext.ts).
 * Anything malformed in `raw` is skipped — never crash.
 */
export function keepVerifiedFindings(
  raw: unknown,
  rules: RuleSpec[],
  text: string,
  files: FileSpan[],
): RuleFinding[] {
  throw new Error("TODO(feat/91): keepVerifiedFindings — see LEARNING.md step 5");
}

// ---------------------------------------------------------------------------
// 3. The Grader
// ---------------------------------------------------------------------------

/**
 * id: `vertex:${env.vertexModel}`
 * grade(input): ONE callGemini call with buildGradePrompt + gradeSchema, then
 * keepVerifiedFindings. No rules → return [] without calling Gemini.
 * Abort the call after env.aiTimeoutMs (AbortController + setTimeout).
 */
export function createVertexGrader(): Grader {
  throw new Error("TODO(feat/91): createVertexGrader — see LEARNING.md step 6");
}

// ---------------------------------------------------------------------------
// Summarizer — built in feat/92. Leave this placeholder alone for now.
// ---------------------------------------------------------------------------

export function createVertexSummarizer(): Summarizer {
  return {
    id: "vertex:unconfigured",
    async summarize() {
      throw new Error("The Vertex summarizer arrives in feat/92/tor-ai-summary");
    },
  };
}
