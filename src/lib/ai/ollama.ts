import { env } from "../../config/env.ts";
import { routeRules } from "./route.ts";
import { isDescriptive } from "./summaryGuard.ts";
import {
  isVerbatim,
  MAX_BULLET_CHARS,
  MAX_BULLETS,
  MAX_EVIDENCE_CHARS,
  type GradeInput,
  type Grader,
  type RuleFinding,
  type RuleSpec,
  type SummaryBullet,
  type SummaryInput,
  type Summarizer,
} from "./types.ts";

// Ollama's /api/chat with a JSON schema in `format`. Two measured constraints
// are baked in and should not be relaxed without re-measuring:
//
//   1. evidence carries maxLength. Unbounded, the model fabricated the tail of
//      a 912-character quote. Bounded, it was verbatim 6/6.
//   2. the prompt DEFINES the rule instead of naming it. Naming scored 0/3;
//      defining scored 3/3 on the same text.

type OllamaResponse = {
  message?: { content?: string };
  error?: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    present: { type: "boolean" },
    quote: { type: "string", maxLength: MAX_EVIDENCE_CHARS },
  },
  required: ["present", "quote"],
} as const;

function buildPrompt(rule: RuleSpec, text: string): string {
  const unfair = rule.unfairWhen
    ? `\nMark present=true only if the clause is ALSO unfair to the contractor: ${rule.unfairWhen}`
    : "";

  return `You are reading a Thai government procurement document.

DEFINITION — ${rule.code}: ${rule.definition}
Thai terms that typically signal it: ${rule.cues.join(", ")}${unfair}

present=true if such a clause appears in the text below.
quote: copy it WORD-FOR-WORD from the text, maximum ${MAX_EVIDENCE_CHARS} characters.
Do not translate, summarise, or rephrase. If present=false, quote must be "".

TEXT:
${text}
`;
}

async function askOne(rule: RuleSpec, text: string, signal: AbortSignal): Promise<RuleFinding | null> {
  const body = JSON.stringify({
    model: env.ollamaModel,
    messages: [{ role: "user", content: buildPrompt(rule, text) }],
    stream: false,
    format: RESPONSE_SCHEMA,
    // temperature 0 for reproducibility: a grade that changes between runs on
    // identical input is not defensible to the agency it describes.
    options: { temperature: 0, num_ctx: 16_384 },
  });

  const response = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });

  if (!response.ok) {
    throw new Error(`ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as OllamaResponse;
  if (payload.error) throw new Error(`ollama: ${payload.error}`);

  let parsed: { present?: unknown; quote?: unknown };
  try {
    parsed = JSON.parse(payload.message?.content ?? "{}");
  } catch {
    // Schema-constrained output that will not parse is a model failure, not a
    // finding. Dropping it is safer than guessing what it meant.
    return null;
  }

  const present = parsed.present === true;
  const quote = typeof parsed.quote === "string" ? parsed.quote.trim() : "";

  // THE GATE (FR-11). A fired rule whose quote is not actually in the document
  // is a hallucination, and it is discarded rather than stored. This is the
  // difference between "the model said so" and "the document says so".
  if (present && !isVerbatim(quote, text)) return null;

  return {
    code: rule.code,
    fired: present,
    evidence: present ? quote : "",
    checked: true,
  };
}

export function createOllamaGrader(): Grader {
  return {
    id: `ollama:${env.ollamaModel}`,

    async grade(input: GradeInput): Promise<RuleFinding[]> {
      const { routed, unrouted } = routeRules(input.rules, input.text);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);

      const findings: RuleFinding[] = [];

      try {
        for (const rule of routed) {
          const finding = await askOne(rule, input.text, controller.signal);
          if (finding) findings.push(finding);
        }
      } finally {
        clearTimeout(timer);
      }

      // A rule no cue matched was never asked. It is reported as unchecked so
      // the scorer can exclude it from the denominator — never as a pass.
      for (const rule of unrouted) {
        findings.push({ code: rule.code, fired: false, evidence: "", checked: false });
      }

      return findings;
    },
  };
}

// ---------------------------------------------------------------------------
// Summarization
// ---------------------------------------------------------------------------

const SUMMARY_SCHEMA = {
  type: "object",
  properties: {
    points: {
      type: "array",
      maxItems: MAX_BULLETS,
      items: { type: "string", maxLength: MAX_BULLET_CHARS },
    },
  },
  required: ["points"],
} as const;

type OllamaSummaryResponse = {
  message?: { content?: string };
  error?: string;
};

/**
 * The prompt carries the FR-19 constraint as an instruction, not just a hope.
 *
 * It follows the same measured lesson as buildPrompt above — define the task
 * rather than naming it — and states the prohibition in terms of the specific
 * judgements a procurement document invites: whether a condition is fair,
 * whether it restricts anyone, what the agency intended. Those are exactly the
 * sentences summaryGuard.ts screens for, so prompt and screen name the same
 * thing from two directions.
 */
function buildSummaryPrompt(text: string): string {
  return `You are reading a Thai government procurement document.

List up to ${MAX_BULLETS} short points stating what this document REQUIRES, SPECIFIES or ANNOUNCES.

Rules:
- Describe only what the document states. Never evaluate it.
- Do not say whether a condition is fair, reasonable, restrictive or suspicious.
- Do not infer the agency's intent, and do not offer advice to the reader.
- Write in Thai, matching the document. One sentence per point, maximum ${MAX_BULLET_CHARS} characters.
- Keep concrete figures, deadlines and quantities — they are the useful part.
- If the document states no substantive requirement, return an empty list.

DOCUMENT:
${text}
`;
}

async function summarizeText(
  text: string,
  signal: AbortSignal,
): Promise<SummaryBullet[]> {
  const body = JSON.stringify({
    model: env.ollamaModel,
    messages: [{ role: "user", content: buildSummaryPrompt(text) }],
    stream: false,
    format: SUMMARY_SCHEMA,
    // Same reasoning as grading: a summary that changes between runs on
    // identical input cannot be explained to the agency it describes.
    options: { temperature: 0, num_ctx: 16_384 },
  });

  const response = await fetch(`${env.ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal,
  });

  if (!response.ok) {
    throw new Error(`ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }

  const payload = (await response.json()) as OllamaSummaryResponse;
  if (payload.error) throw new Error(`ollama: ${payload.error}`);

  let parsed: { points?: unknown };
  try {
    parsed = JSON.parse(payload.message?.content ?? "{}");
  } catch {
    // Schema-constrained output that will not parse is a model failure, not a
    // summary. Dropping it is safer than guessing what it meant.
    return [];
  }

  if (!Array.isArray(parsed.points)) return [];

  return parsed.points
    .filter((point): point is string => typeof point === "string")
    .map((point) => ({ text: point.trim() }))
    // The first of the two FR-19 screens. The second is at the DB boundary in
    // grade.service.ts, mirroring how isVerbatim is applied twice.
    .filter((bullet) => bullet.text.length > 0 && isDescriptive(bullet.text));
}

export function createOllamaSummarizer(): Summarizer {
  return {
    id: `ollama:${env.ollamaModel}`,

    async summarize(input: SummaryInput): Promise<SummaryBullet[]> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);

      try {
        return await summarizeText(input.text, controller.signal);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
