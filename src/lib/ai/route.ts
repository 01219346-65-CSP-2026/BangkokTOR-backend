import type { RuleSpec } from "./types.ts";

// A model call measures ~10s, and most rules have nothing to find in a given
// TOR: a payment-terms rule is pointless on a document that never mentions
// payment. Routing by cue terms skips those calls without changing what can be
// found, because a clause that mentions none of its own vocabulary is not that
// clause.

export type RoutedRules = {
  /** Rules whose cues appear in the text — each costs one model call. */
  routed: RuleSpec[];
  /** Rules no cue matched. Reported as `checked: false`, never as a pass. */
  unrouted: RuleSpec[];
};

function mentionsAny(haystack: string, cues: string[]): boolean {
  return cues.some((cue) => haystack.includes(cue));
}

/**
 * Split the rules into those worth asking the model about and those that are not.
 *
 * A rule whose cues appear nowhere yields no call at all — and the caller must
 * treat that as "not found", never as "passed". The distinction matters: a rule
 * that was never checked is not a rule that was satisfied.
 */
export function routeRules(rules: RuleSpec[], text: string): RoutedRules {
  const routed: RuleSpec[] = [];
  const unrouted: RuleSpec[] = [];

  for (const rule of rules) {
    (mentionsAny(text, rule.cues) ? routed : unrouted).push(rule);
  }

  return { routed, unrouted };
}
