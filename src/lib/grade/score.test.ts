import { describe, expect, test } from "bun:test";
import { gradeFindings, PASS_THRESHOLD, skipFairness, type Finding } from "./score.ts";
import { FAIRNESS_RULES, LEGITIMACY_RULES, RULES } from "./rules.ts";

const ok = (code: string): Finding => ({ code, fired: false, evidence: "", checked: true });
const fired = (code: string): Finding => ({
  code,
  fired: true,
  evidence: "หลักฐาน",
  checked: true,
});
const unchecked = (code: string): Finding => ({
  code,
  fired: false,
  evidence: "",
  checked: false,
});

/** Every rule of a phase passing. */
const allOk = (phase: "legitimacy" | "fairness") =>
  RULES.filter((r) => r.phase === phase && r.method !== "not_checked").map((r) => ok(r.code));

describe("the rulebook itself", () => {
  test("weights match the specification", () => {
    const sum = (rs: typeof RULES) => rs.reduce((n, r) => n + r.weight, 0);
    expect(sum(LEGITIMACY_RULES)).toBe(16);
    expect(sum(FAIRNESS_RULES)).toBe(26);
    expect(sum(RULES)).toBe(42);
    expect(RULES).toHaveLength(15);
  });

  test("every AI rule carries the definition the model is measured to need", () => {
    // Naming a rule scored 0/3 against real Thai text; defining it scored 3/3.
    // A rule shipped without a definition would silently underperform.
    for (const rule of RULES.filter((r) => r.method === "ai")) {
      expect(rule.definition.length).toBeGreaterThan(20);
      expect(rule.cues.length).toBeGreaterThan(0);
    }
  });
});

describe("gradeFindings", () => {
  test("A — both phases pass", () => {
    const result = gradeFindings([...allOk("legitimacy"), ...allOk("fairness")]);
    expect(result.grade).toBe("A");
    expect(result.phaseFailed).toBeNull();
  });

  test("B — legitimacy passes, fairness fails", () => {
    // LIABILITY(4) + NODAYSOFF(4) + HOURS(3) = 11 of 26 fired -> 57.7%, under 60.
    const result = gradeFindings([
      ...allOk("legitimacy"),
      ...allOk("fairness").filter((f) => !["LIABILITY", "NODAYSOFF", "HOURS"].includes(f.code)),
      fired("LIABILITY"),
      fired("NODAYSOFF"),
      fired("HOURS"),
    ]);
    expect(result.grade).toBe("B");
    expect(result.phaseFailed).toBe("fairness");
  });

  test("C — legitimacy fails, and fairness is not scored at all", () => {
    const result = gradeFindings([
      ...allOk("legitimacy").filter((f) => !["IDMISMATCH", "BUDGETMISMATCH"].includes(f.code)),
      fired("IDMISMATCH"),
      fired("BUDGETMISMATCH"),
      ...allOk("fairness"),
    ]);
    expect(result.grade).toBe("C");
    expect(result.phaseFailed).toBe("legitimacy");
    // Not merely failed — never evaluated. The rulebook says skip it.
    expect(result.fairness.score).toBeNull();
  });

  test("REPUTATION is excluded from the denominator, not counted as a pass", () => {
    // Legitimacy checkable weight is 14 (16 minus REPUTATION's 2). If REPUTATION
    // silently passed, the denominator would be 16 and every score would shift.
    const result = gradeFindings([...allOk("legitimacy"), ...allOk("fairness")]);
    expect(result.legitimacy.checkedWeight).toBe(14);
  });

  test("an unchecked rule leaves the denominator entirely", () => {
    const withUnchecked = gradeFindings([
      ...allOk("legitimacy"),
      ...allOk("fairness").filter((f) => f.code !== "IPGRAB"),
      unchecked("IPGRAB"),
    ]);
    // IPGRAB weighs 2; 26 - 2 (IPGRAB) = 24.
    expect(withUnchecked.fairness.checkedWeight).toBe(24);
    // And it is not treated as fired either.
    expect(withUnchecked.fairness.firedCodes).not.toContain("IPGRAB");
  });

  test("a phase with nothing checked does not pass by default", () => {
    const result = gradeFindings(RULES.map((r) => unchecked(r.code)));
    expect(result.grade).toBe("C");
    expect(result.legitimacy.score).toBeNull();
  });

  test("the threshold is exclusive — exactly 60% fails", () => {
    // Fairness: fire NODAYSOFF(4) + LIABILITY(4) + HOURS(3) ... need exactly 40%
    // fired. 26 * 0.4 = 10.4, so use a subset summing to 10: 4+3+3.
    const result = gradeFindings([
      ...allOk("legitimacy"),
      ...allOk("fairness").filter((f) => !["LIABILITY", "HOURS", "TERMINATE"].includes(f.code)),
      fired("LIABILITY"),
      fired("HOURS"),
      fired("TERMINATE"),
    ]);
    // (26-10)/26 = 61.5% -> passes, just.
    expect(result.fairness.score).toBeCloseTo(61.5, 1);
    expect(result.grade).toBe("A");
    expect(PASS_THRESHOLD).toBe(60);
  });

  test("findings for unknown codes are ignored, not trusted", () => {
    const result = gradeFindings([
      ...allOk("legitimacy"),
      ...allOk("fairness"),
      { code: "MADE_UP_RULE", fired: true, evidence: "x", checked: true },
    ]);
    expect(result.grade).toBe("A");
  });
});

describe("skipFairness", () => {
  test("true when legitimacy failed, so its model calls are never spent", () => {
    expect(
      skipFairness([
        ...allOk("legitimacy").filter((f) => f.code !== "IDMISMATCH"),
        fired("IDMISMATCH"),
        fired("NOENTITY"),
      ]),
    ).toBe(true);
  });

  test("false when legitimacy passed", () => {
    expect(skipFairness(allOk("legitimacy"))).toBe(false);
  });
});
