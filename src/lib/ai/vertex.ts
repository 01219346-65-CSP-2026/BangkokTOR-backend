import { env } from "../../config/env.ts";
import { fileAt, type FileSpan } from "../extract/fulltext.ts";
import { isVerbatim, locateQuote } from "./types.ts";
import type { GradeInput, Grader, RuleFinding, RuleSpec, Summarizer } from "./types.ts";

const MAX_EVIDENCE_CHARS = 200;

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
  //throw new Error("TODO(feat/91): callGemini — see LEARNING.md step 4");
  assertVertexConfig();

  const apiKey = env.vertexApiKey;
  const model = env.vertexModel;

  const response = await fetch(
    `${VERTEX_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: req.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: req.prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: req.schema,
        },
      }),
    },
  )

  if (!response.ok) {
    // Don't include the request URL: it contains the API key.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Vertex AI request failed (${response.status})${detail ? `: ${detail}` : ""}`,
    );
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    promptFeedback?: { blockReason?: string };
  };

  if (data.promptFeedback?.blockReason) {
    throw new Error(`Gemini prompt was blocked: ${data.promptFeedback.blockReason}`);
  }

  const candidate = data.candidates?.[0];
  if (!candidate) {
    throw new Error("Gemini returned no candidate");
  }
  if (candidate.finishReason !== "STOP") {
    throw new Error(`Gemini finished unexpectedly: ${candidate.finishReason ?? "unknown"}`);
  }

  const text = candidate.content?.parts?.map(part => part.text ?? "").join("");
  if (!text) {
    throw new Error("Gemini returned no response text");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Gemini response was not valid JSON");
  }
}

/** Throw a clear error mentioning VERTEX_API_KEY when env.vertexApiKey is empty. */
export function assertVertexConfig(): void {
  if (!env.vertexApiKey) {
    throw new Error("VERTEX_API_KEY is not set");
  }
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
  return {
    type: "OBJECT",
    properties: {
      findings: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            code: { type: "STRING", enum: codes },
            present: { type: "BOOLEAN" },
            quote: { type: "STRING", maxLength: 200 },
          },
          required: ["code", "present", "quote"],
        },
      },
    },
    required: ["findings"],
  };
}

/**
 * The question: "for each rule, does the document contain such a clause? If
 * so, quote it word-for-word." Must include, for every rule, its code in
 * [BRACKETS], its definition, its unfairWhen (if any) and its cue words; the
 * words WORD-FOR-WORD and the MAX_EVIDENCE_CHARS limit; and the whole text.
 */
export function buildGradePrompt(rules: RuleSpec[], text: string): string {
  const sections = rules.map((rule) => {
    const unfairWhen = rule.unfairWhen ? `\nUnfair when: ${rule.unfairWhen}` : "";
    const cues = rule.cues.length > 0 ? `\nCue words: ${rule.cues.join(", ")}` : "";
    return `[${rule.code}]\nDefinition: ${rule.definition}${unfairWhen}${cues}`;
  });

  return [
    "Read the entire document below and answer for every rule.",
    "For each rule, return one object: { code, present, quote }.",
    "The code must be exactly one of the rule codes in this prompt.",
    "Set present to true only when the document contains a matching clause.",
    "Set quote to a WORD-FOR-WORD excerpt from the document, at most " +
      MAX_EVIDENCE_CHARS + " characters long.",
    "Do not paraphrase. Do not invent text. If a rule is absent, use present=false and an empty quote.",
    "",
    ...sections,
    "",
    "Document:",
    text,
  ].join("\n");
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
  if (!raw || typeof raw !== "object" || !("findings" in raw) || !Array.isArray(raw.findings)) {
    return rules.map((rule) => ({
      code: rule.code,
      fired: false,
      evidence: "",
      checked: false,
      filename: null,
    }));
  }

  const findings = raw.findings as unknown[];

  return rules.map((rule) => {
    const item = findings.find((entry) => {
      if (!entry || typeof entry !== "object" || !("code" in entry)) return false;
      return entry.code === rule.code;
    });

    if (!item || typeof item !== "object") {
      return { code: rule.code, fired: false, evidence: "", checked: false, filename: null };
    }

    const candidate = item as Record<string, unknown>;
    const present = candidate.present;
    const quote = typeof candidate.quote === "string" ? candidate.quote : "";

    if (present !== true) {
      return {
        code: rule.code,
        fired: false,
        evidence: "",
        checked: present === false,
        filename: null,
      };
    }

    if (!isVerbatim(quote, text)) {
      return { code: rule.code, fired: false, evidence: "", checked: false, filename: null };
    }

    const offset = locateQuote(quote, text);
    return {
      code: rule.code,
      fired: true,
      evidence: quote,
      checked: true,
      filename: fileAt(files, offset),
    };
  });
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
  return {
    id: `vertex:${env.vertexModel}`,
    async grade(input) {
      if (input.rules.length === 0) return [];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), env.aiTimeoutMs);

      try {
        const raw = await callGemini({
          prompt: buildGradePrompt(input.rules, input.text),
          schema: gradeSchema(input.rules.map((rule) => rule.code)),
          signal: controller.signal,
        });
        return keepVerifiedFindings(raw, input.rules, input.text, input.files);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
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
