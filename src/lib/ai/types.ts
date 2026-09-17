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

// The summarizer port.
//
// Deliberately a sibling of Grader rather than a second method on it: Grader
// has exactly one implementation pair today (ollama + the vertex stub), and
// widening it would break vertex.ts for a capability it does not have.
//
// The two ports differ in what they are allowed to say, not just in what they
// return. A finding quotes the document verbatim and is checked against it. A
// bullet is generated prose about a named government agency, which FR-19 says
// must never read as an accusation — so the bullets are constrained at the
// prompt, screened on the way out of the model, and screened again before they
// are written. See summaryGuard.ts.

/** One point about what a section of the document states. */
export type SummaryBullet = {
  text: string;
  /** Which chunk produced it, so a point can be traced back to a page. */
  chunkIndex: number;
};

export type SummaryInput = {
  chunks: GradeChunk[];
};

export type Summarizer = {
  /** Same shape as Grader.id, e.g. "ollama:qwen2.5:7b", and stored on the TOR
   *  for the same reason: knowing which rows to redo when the model changes. */
  readonly id: string;
  summarize(input: SummaryInput): Promise<SummaryBullet[]>;
};

/** One sentence, not a paragraph. Also bounds the JSON schema sent to the
 *  model — the lesson from MAX_EVIDENCE_CHARS above is that an unbounded
 *  string field is where fabrication starts. */
export const MAX_BULLET_CHARS = 180;

/** What the detail page can show without becoming a wall of text again. */
export const MAX_BULLETS = 8;

/**
 * How many chunks a summary pass will read.
 *
 * A TOR carries up to 24 chunks and a call measures ~10s, so summarizing all of
 * them would add ~4 minutes to a grade run — and `aiTimeoutMs` is a per-batch
 * budget, so the pass would abort part way and lose everything. Ten keeps the
 * worst case near 100s.
 */
export const MAX_SUMMARY_CHUNKS = 10;

/** Whitespace-insensitive containment: extraction leaves column gutters as
 *  runs of spaces, so an otherwise-faithful quote can differ by whitespace. */
export function isVerbatim(evidence: string, haystack: string): boolean {
  if (!evidence.trim()) return false;
  const strip = (s: string) => s.replace(/\s+/g, "");
  return strip(haystack).includes(strip(evidence));
}
