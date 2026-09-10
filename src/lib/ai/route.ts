import type { GradeChunk, RuleSpec } from "./types.ts";

// Sending every rule to every chunk costs 12 x 24 x ~10s = ~48 minutes per TOR.
// Most of that is wasted: a payment-terms rule has nothing to learn from a
// chunk about vehicle specifications. Routing by cue terms cuts the call count
// several-fold without changing what can be found, because a clause that
// mentions none of its own vocabulary is not that clause.

/** How many chunks one rule may be sent to, best first. A clause that appears
 *  in twenty places does not need twenty model calls to be established. */
export const MAX_CHUNKS_PER_RULE = 4;

export type RoutedCall = {
  rule: RuleSpec;
  chunk: GradeChunk;
  /** Cue hits that earned this pairing — useful when auditing a miss. */
  score: number;
};

function countCues(haystack: string, cues: string[]): number {
  let hits = 0;
  for (const cue of cues) {
    if (haystack.includes(cue)) hits++;
  }
  return hits;
}

/**
 * Pair each rule with the chunks most likely to contain it.
 *
 * A rule whose cues appear nowhere yields no calls at all — and the caller must
 * treat that as "not found", never as "passed". The distinction matters: a rule
 * that was never checked is not a rule that was satisfied.
 */
export function routeChunks(rules: RuleSpec[], chunks: GradeChunk[]): RoutedCall[] {
  const calls: RoutedCall[] = [];

  for (const rule of rules) {
    const scored: RoutedCall[] = [];

    for (const chunk of chunks) {
      // The heading path is weighted higher than the body: a section titled
      // "ค่าปรับ" is about penalties in a way that one passing mention is not.
      const heading = chunk.headingPath.join(" ");
      const score = countCues(heading, rule.cues) * 3 + countCues(chunk.text, rule.cues);
      if (score > 0) scored.push({ rule, chunk, score });
    }

    scored.sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
    calls.push(...scored.slice(0, MAX_CHUNKS_PER_RULE));
  }

  return calls;
}

/** Rules that no chunk matched. Reported as `checked: false` rather than as a
 *  pass — see the note in routeChunks. */
export function unroutedRules(rules: RuleSpec[], calls: RoutedCall[]): RuleSpec[] {
  const routed = new Set(calls.map((c) => c.rule.code));
  return rules.filter((r) => !routed.has(r.code));
}
