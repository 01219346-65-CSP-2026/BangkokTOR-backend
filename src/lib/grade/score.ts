import { FAIRNESS_RULES, LEGITIMACY_RULES, ruleByCode, type Rule } from "./rules.ts";

// Pure. Given findings, produce a grade — no I/O, no model, no clock, so the
// whole A/B/C policy is testable from fixtures.

export type Grade = "A" | "B" | "C";

export type Finding = {
  code: string;
  fired: boolean;
  evidence: string;
  /** False when the rule was never actually evaluated. Such a rule leaves BOTH
   *  the numerator and the denominator — it is neither a pass nor a fail. */
  checked: boolean;
  chunkIndex?: number | null;
};

export type PhaseResult = {
  score: number | null;
  passed: boolean;
  checkedWeight: number;
  firedWeight: number;
  firedCodes: string[];
};

export type GradeResult = {
  grade: Grade;
  score: number | null;
  phaseFailed: "legitimacy" | "fairness" | null;
  legitimacy: PhaseResult;
  fairness: PhaseResult;
};

/** A TOR passes a phase above this. Set in one place so tuning is one edit. */
export const PASS_THRESHOLD = 60;

function scorePhase(rules: Rule[], findings: Map<string, Finding>): PhaseResult {
  let checkedWeight = 0;
  let firedWeight = 0;
  const firedCodes: string[] = [];

  for (const rule of rules) {
    const finding = findings.get(rule.code);
    // not_checked rules (REPUTATION) and unrouted rules never enter the
    // denominator. Scoring a rule nobody evaluated as a pass would inflate
    // every grade in the corpus.
    if (!finding?.checked) continue;

    checkedWeight += rule.weight;
    if (finding.fired) {
      firedWeight += rule.weight;
      firedCodes.push(rule.code);
    }
  }

  // Nothing checked: no opinion. Not a pass — the caller decides what to do
  // with a phase that could not be evaluated.
  if (checkedWeight === 0) {
    return { score: null, passed: false, checkedWeight: 0, firedWeight: 0, firedCodes };
  }

  // The share of checked weight that did NOT fire.
  const score = ((checkedWeight - firedWeight) / checkedWeight) * 100;

  return {
    score: Math.round(score * 10) / 10,
    passed: score > PASS_THRESHOLD,
    checkedWeight,
    firedWeight,
    firedCodes,
  };
}

/**
 * A = legitimacy passed and fairness passed
 * B = legitimacy passed, fairness failed
 * C = legitimacy failed (fairness is not evaluated — see `skipFairness`)
 */
export function gradeFindings(findings: Finding[]): GradeResult {
  const byCode = new Map<string, Finding>();
  for (const f of findings) {
    // A finding for a code that is not in the rulebook is ignored rather than
    // trusted: the rulebook is the authority on what counts.
    if (ruleByCode(f.code)) byCode.set(f.code, f);
  }

  const legitimacy = scorePhase(LEGITIMACY_RULES, byCode);

  if (!legitimacy.passed) {
    return {
      grade: "C",
      score: legitimacy.score,
      phaseFailed: "legitimacy",
      legitimacy,
      fairness: { score: null, passed: false, checkedWeight: 0, firedWeight: 0, firedCodes: [] },
    };
  }

  const fairness = scorePhase(FAIRNESS_RULES, byCode);

  return {
    grade: fairness.passed ? "A" : "B",
    score: fairness.score,
    phaseFailed: fairness.passed ? null : "fairness",
    legitimacy,
    fairness,
  };
}

/** True when legitimacy already failed, so the fairness pass can be skipped
 *  before its model calls are spent. */
export function skipFairness(legitimacyFindings: Finding[]): boolean {
  const byCode = new Map(legitimacyFindings.map((f) => [f.code, f]));
  return !scorePhase(LEGITIMACY_RULES, byCode).passed;
}
