import { env } from "../../config/env.ts";
import { routeChunks, unroutedRules, type RoutedCall } from "./route.ts";
import {
  isVerbatim,
  MAX_EVIDENCE_CHARS,
  type GradeInput,
  type Grader,
  type RuleFinding,
  type RuleSpec,
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
