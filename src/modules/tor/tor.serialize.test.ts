import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import { serialize, serializeGrade } from "./tor.serialize.ts";
import type { TorLean } from "./tor.model.ts";

function tor(overrides: Record<string, unknown> = {}): TorLean {
  return {
    _id: new Types.ObjectId(),
    sourceId: "ckan-egp",
    projectId: "67119569806",
    projectName: "จ้างพัฒนาระบบสารสนเทศ",
    agency: "กรมการปกครอง",
    grade: "C",
    gradeScore: 42.5,
    gradePhaseFailed: "legitimacy",
    graderModel: "ollama:qwen2.5:7b",
    graderVersion: 1,
    ruleFindings: [
      { code: "IDMISMATCH", fired: true, weight: 4, phase: "legitimacy", evidence: "กรมอื่น", checked: true, chunkIndex: 1 },
      { code: "PENALTY", fired: true, weight: 3, phase: "fairness", evidence: "ค่าปรับวันละ", checked: true, chunkIndex: 4 },
      { code: "HOURS", fired: false, weight: 3, phase: "fairness", evidence: "", checked: true, chunkIndex: 2 },
    ],
    ...overrides,
  } as unknown as TorLean;
}

describe("serialize — the FR-19 gate", () => {
  test("never emits the letter grade or the score", () => {
    // AGENTS.md §1: a public "Grade C" on a named agency is the accusatory
    // shape the requirement forbids. This assertion IS the requirement.
    const out = serialize(tor()) as Record<string, unknown>;

    expect(out.grade).toBeUndefined();
    expect(out.gradeScore).toBeUndefined();
    expect(out.gradePhaseFailed).toBeUndefined();
    expect(out.ruleFindings).toBeUndefined();
    expect(out.graderModel).toBeUndefined();
    expect(out.graderVersion).toBeUndefined();
  });

  test("the serialized JSON contains no grade letter anywhere", () => {
    // Belt and braces: a future field could reintroduce it by accident.
    const json = JSON.stringify(serialize(tor()));
    expect(json).not.toContain('"grade"');
    expect(json).not.toContain("legitimacy");
    expect(json).not.toContain("ollama");
  });

  test("evidence quotes never reach the public shape", () => {
    // A verbatim quote is evidence for an internal audit, not a public claim.
    const json = JSON.stringify(serialize(tor()));
    expect(json).not.toContain("กรมอื่น");
    expect(json).not.toContain("ค่าปรับวันละ");
  });

  test("emits a neutral signal count and vocabulary instead", () => {
    const out = serialize(tor());
    expect(out.signalCount).toBe(2); // two fired, the unfired one excluded
    expect(out.signals.map((s) => s.id).sort()).toEqual(["idmismatch", "penalty"]);
    for (const s of out.signals) {
      expect(s.tone).toBe("notable");
      // Translation keys, so the wording lives in the frontend's vetted
      // vocabulary rather than being asserted by the backend.
      expect(s.titleKey).toMatch(/^signals\./);
      expect(s.bodyKey).toMatch(/^signals\./);
    }
  });

  test("a clean TOR reports zero signals rather than an empty field", () => {
    const out = serialize(tor({ ruleFindings: [] }));
    expect(out.signalCount).toBe(0);
    expect(out.signals).toEqual([]);
  });

  test("_id becomes id at the boundary", () => {
    const t = tor();
    const out = serialize(t) as Record<string, unknown>;
    expect(out.id).toBe(String(t._id));
    expect(out._id).toBeUndefined();
  });

  test("a finding for an unknown rule code is dropped, not rendered", () => {
    const out = serialize(
      tor({
        ruleFindings: [
          { code: "NOT_A_RULE", fired: true, weight: 9, phase: "fairness", evidence: "x", checked: true, chunkIndex: 0 },
        ],
      }),
    );
    expect(out.signals).toEqual([]);
  });
});

describe("serializeGrade — the internal shape", () => {
  test("does expose the full grade, on its own route", () => {
    const out = serializeGrade(tor());
    expect(out.grade).toBe("C");
    expect(out.gradeScore).toBe(42.5);
    expect(out.findings).toHaveLength(3);
    expect(out.graderModel).toBe("ollama:qwen2.5:7b");
  });

  test("keeps evidence so a grade can be audited", () => {
    const out = serializeGrade(tor());
    expect(out.findings.find((f) => f.code === "IDMISMATCH")?.evidence).toBe("กรมอื่น");
  });
});
