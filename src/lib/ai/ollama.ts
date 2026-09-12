import { env } from "../../config/env.ts";
import { routeChunks, unroutedRules, type RoutedCall } from "./route.ts";
import { isDescriptive } from "./summaryGuard.ts";
import {
  isVerbatim,
  MAX_BULLET_CHARS,
  MAX_BULLETS,
  MAX_EVIDENCE_CHARS,
  MAX_SUMMARY_CHUNKS,
  type GradeChunk,
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

async function askOne(call: RoutedCall, signal: AbortSignal): Promise<RuleFinding | null> {
  const body = JSON.stringify({
    model: env.ollamaModel,
    messages: [{ role: "user", content: buildPrompt(call.rule, call.chunk.text) }],
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
  if (present && !isVerbatim(quote, call.chunk.text)) return null;

  return {
    code: call.rule.code,
    fired: present,
    evidence: present ? quote : "",
    chunkIndex: call.chunk.index,
  };
}

export function createOllamaGrader(): Grader {
  return {
    id: `ollama:${env.ollamaModel}`,

    async gradeChunks(input: GradeInput): Promise<RuleFinding[]> {
      const calls = routeChunks(input.rules, input.chunks);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), env.aiTimeoutMs);

      // Per rule, best evidence wins: the first chunk that yields a verbatim
      // quote establishes the clause, and the remaining chunks for that rule
      // are skipped. Measured ~10s per call, so not making a call is the
      // single biggest saving available.
      const byCode = new Map<string, RuleFinding>();

      try {
        for (const call of calls) {
          const settled = byCode.get(call.rule.code);
          if (settled?.fired) continue;

          const finding = await askOne(call, controller.signal);
          if (!finding) continue;

          if (finding.fired || !settled) byCode.set(call.rule.code, finding);
        }
      } finally {
        clearTimeout(timer);
      }

      const findings = [...byCode.values()];

      // A rule no chunk matched was never asked. It is reported as not fired
      // with a null chunk so the scorer can exclude it from the denominator —
      // never as a pass.
      for (const rule of unroutedRules(input.rules, calls)) {
        findings.push({ code: rule.code, fired: false, evidence: "", chunkIndex: null });
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
      // Three per section. The cap is per-call rather than global because the
      // model cannot see how many points earlier sections produced.
      maxItems: 3,
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
function buildSummaryPrompt(chunk: GradeChunk): string {
  const heading = chunk.headingPath.length > 0
    ? `\nThis section appears under: ${chunk.headingPath.join(" / ")}`
    : "";

  return `You are reading one section of a Thai government procurement document.${heading}

List up to 3 short points stating what this section REQUIRES, SPECIFIES or ANNOUNCES.

Rules:
- Describe only what the document states. Never evaluate it.
- Do not say whether a condition is fair, reasonable, restrictive or suspicious.
- Do not infer the agency's intent, and do not offer advice to the reader.
- Write in Thai, matching the document. One sentence per point, maximum ${MAX_BULLET_CHARS} characters.
- Keep concrete figures, deadlines and quantities — they are the useful part.
- If the section states no substantive requirement, return an empty list.

SECTION:
${chunk.text}
`;
}

/**
 * Which chunks to read, and in what order.
 *
 * A chunk with a headingPath sits under a real heading, which is where the
 * requirements live; an unheaded chunk is usually a continuation or the
 * boilerplate front matter every announcement repeats. Ordering by that and
 * then truncating spends the budget on the sections worth summarizing rather
 * than on whichever ones happened to be extracted first.
 */
function pickSummaryChunks(chunks: GradeChunk[]): GradeChunk[] {
  return [...chunks]
    .sort((a, b) => {
      const byHeading = Number(b.headingPath.length > 0) - Number(a.headingPath.length > 0);
      return byHeading !== 0 ? byHeading : a.index - b.index;
    })
    .slice(0, MAX_SUMMARY_CHUNKS);
}

async function summarizeOne(
  chunk: GradeChunk,
  signal: AbortSignal,
): Promise<SummaryBullet[]> {
  const body = JSON.stringify({
    model: env.ollamaModel,
    messages: [{ role: "user", content: buildSummaryPrompt(chunk) }],
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
    // summary. Dropping this section is safer than guessing what it meant.
    return [];
  }

  if (!Array.isArray(parsed.points)) return [];

  return parsed.points
    .filter((point): point is string => typeof point === "string")
    .map((point) => ({ text: point.trim(), chunkIndex: chunk.index }))
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

      const bullets: SummaryBullet[] = [];

      try {
        for (const chunk of pickSummaryChunks(input.chunks)) {
          // Stop as soon as the page has what it can show. Not making a call is
          // the largest saving available at ~10s each.
          if (bullets.length >= MAX_BULLETS) break;
          bullets.push(...(await summarizeOne(chunk, controller.signal)));
        }
      } finally {
        clearTimeout(timer);
      }

      return bullets;
    },
  };
}
