// The grader port. Ollama implements it today; Vertex implements it later
// without any caller changing — that swap is the whole reason this file exists.

/** A rule as the model sees it. The definition is load-bearing: measured
 *  2026-09-08, asking qwen2.5:7b about a bare rule name scored 0/3, while the
 *  same question with an explicit definition scored 3/3. */
export type RuleSpec = {
  code: string;
  /** What the clause IS, in one sentence. Sent to the model verbatim. */
  definition: string;
  /** What makes it unfair. Absent for presence-only (legitimacy) rules. */
  unfairWhen?: string;
  /** Thai cue terms. Used to route chunks, and quoted to the model as hints. */
  cues: string[];
};

export type GradeChunk = {
  index: number;
  headingPath: string[];
  text: string;
};

export type RuleFinding = {
  code: string;
  fired: boolean;
  /** VERBATIM quote from the chunk. A fired finding without one is discarded
   *  by the caller — that is what makes FR-11 enforceable rather than hoped for. */
  evidence: string;
  /** Which chunk produced it, so a quote can be traced back to a page. */
  chunkIndex: number | null;
};

export type GradeInput = {
  rules: RuleSpec[];
  chunks: GradeChunk[];
};

export type Grader = {
  /** Identifies what produced a grade, e.g. "ollama:qwen2.5:7b". Stored on the
   *  TOR so you know which rows to regrade when the model changes. */
  readonly id: string;
  gradeChunks(input: GradeInput): Promise<RuleFinding[]>;
};

// Measured cap. Unbounded, the model produced a 912-character "quote" that was
// accurate for ~227 characters and paraphrase after that. At 200 it was
// verbatim 6/6.
export const MAX_EVIDENCE_CHARS = 200;

/** Whitespace-insensitive containment: extraction leaves column gutters as
 *  runs of spaces, so an otherwise-faithful quote can differ by whitespace. */
export function isVerbatim(evidence: string, haystack: string): boolean {
  if (!evidence.trim()) return false;
  const strip = (s: string) => s.replace(/\s+/g, "");
  return strip(haystack).includes(strip(evidence));
}
