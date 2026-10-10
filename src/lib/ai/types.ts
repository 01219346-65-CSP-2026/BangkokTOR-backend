// The grader port. Ollama implements it today; Vertex implements it later
// without any caller changing — that swap is the whole reason this file exists.

import type { FileSpan } from "../extract/fulltext";

/** A rule as the model sees it. The definition is load-bearing: measured
 *  2026-09-08, asking qwen2.5:7b about a bare rule name scored 0/3, while the
 *  same question with an explicit definition scored 3/3. */
export type RuleSpec = {
  code: string;
  /** What the clause IS, in one sentence. Sent to the model verbatim. */
  definition: string;
  /** What makes it unfair. Absent for presence-only (legitimacy) rules. */
  unfairWhen?: string;
  /** Thai cue terms. Used to route rules, and quoted to the model as hints. */
  cues: string[];
};

export type RuleFinding = {
  code: string;
  fired: boolean;
  /** VERBATIM quote from the document. A fired finding without one is discarded
   *  by the caller — that is what makes FR-11 enforceable rather than hoped for. */
  evidence: string;
  /** False when the rule was never asked — none of its cues appear in the text. */
  checked: boolean;
  filename: string | null;
};

export type GradeInput = {
  rules: RuleSpec[];
  /** The TOR's full extracted text. */
  text: string;
  files: FileSpan[];
};

export type Grader = {
  /** Identifies what produced a grade, e.g. "ollama:qwen2.5:7b". Stored on the
   *  TOR so you know which rows to regrade when the model changes. */
  readonly id: string;
  grade(input: GradeInput): Promise<RuleFinding[]>;
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

/** One point about what the document states.
 *  TODO(feat/92) step 1: add `section: SummarySection | null` and
 *  `filename: string | null`. */
export type SummaryBullet = {
  text: string;
};

// TODO(feat/92) step 1: SummaryInput also takes the FileSpan list.
export type SummaryInput = {
  /** The TOR's full extracted text. */
  text: string;
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

/**
 * The three topics the detail page shows, as three cards (feat/92):
 *   objective      วัตถุประสงค์        why the agency is buying this
 *   scope          ขอบเขตงาน          what the winner must deliver
 *   qualifications คุณสมบัติผู้เสนอราคา  who is allowed to bid
 * The order here is the order on the page. Given — you use these, you don't
 * change them.
 */
export const SUMMARY_SECTIONS = ["objective", "scope", "qualifications"] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];

/** Per card. Enough for a scope of work, short enough to read on a phone. */
export const MAX_POINTS_PER_SECTION = 5;

/** The whole summary: every card full. */
export const MAX_BULLETS = SUMMARY_SECTIONS.length * MAX_POINTS_PER_SECTION;

/** Whitespace-insensitive containment: extraction leaves column gutters as
 *  runs of spaces, so an otherwise-faithful quote can differ by whitespace. */
export function isVerbatim(evidence: string, haystack: string): boolean {
  if (!evidence.trim()) return false;
  const strip = (s: string) => s.replace(/\s+/g, "");
  return strip(haystack).includes(strip(evidence));
}

/**
 * TODO(feat/91) — see LEARNING.md step 3.
 *
 * WHERE in `haystack` does `quote` start? Same whitespace-insensitive match as
 * isVerbatim above, but return the character POSITION in the ORIGINAL
 * haystack, or -1 when not found (or when the quote is blank).
 *
 * Hints:
 *   - Try haystack.indexOf(quote) first — usually that is enough.
 *   - If it misses, the difference is whitespace. Walk the haystack one
 *     character at a time, building a copy WITHOUT whitespace, and remember
 *     for each kept character where it was in the original (an array of
 *     numbers). Find the stripped quote in the stripped copy, then use that
 *     array to translate the position back.
 */
export function locateQuote(quote: string, haystack: string): number {
  const strip = (s: string) => s.replace(/\s+/g, "");

  if (!quote.trim()) 
    return -1;

  // better optimized if enabled, but misses a non significant edge case.
  /*const a = haystack.indexOf(quote);
  if (a !== -1) 
    return a;*/
  
  const strippedChars: string[] = [];
  const originalIndexes: number[] = [];

  for (let i = 0; i < haystack.length; i++) {
    if (!/\s/.test(haystack.charAt(i))) {
      strippedChars.push(haystack.charAt(i));
      originalIndexes.push(i);
    }
  }

  const strippedText = strippedChars.join("");
  const strippedIndex = strippedText.indexOf(strip(quote));

  if (strippedIndex === -1) return -1;
  else {
    return originalIndexes[strippedIndex] ?? -1;
  }
}
