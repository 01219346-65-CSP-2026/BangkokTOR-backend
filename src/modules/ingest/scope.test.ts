import { describe, expect, test } from "bun:test";
import type { RawProject } from "../../lib/sources/types.ts";
import { classifyRaw, isSoftwareCandidate, scopeOf } from "./scope.ts";

// Unshifted rows (no header), so the fields read at face value.
function raw(title: string, type: string, fiscalYear = 2568): RawProject {
  return {
    projectId: "1",
    fields: {
      "รหัสโครงการ": "1",
      "ชื่อโครงการ": title,
      "ชื่อประเภทโครงการ": type,
      "ชื่อหน่วยงาน": "หน่วยงาน",
      "ปีงบประมาณ": fiscalYear,
    },
  };
}

describe("scopeOf", () => {
  test("software development in the current year is kept", () => {
    const c = classifyRaw(raw("จ้างพัฒนาระบบสารสนเทศเพื่อการบริหารจัดการ", "จ้างทำของ/จ้างเหมาบริการ"));
    expect(scopeOf(c, 2568)).toBe("in-scope");
  });

  test("a hardware purchase is dropped", () => {
    const c = classifyRaw(raw("ซื้อครุภัณฑ์คอมพิวเตอร์ เครื่องคอมพิวเตอร์", "ซื้อ"));
    expect(scopeOf(c, 2568)).toBe("not-software");
  });

  test("another year is dropped even when it is software", () => {
    const c = classifyRaw(raw("จ้างพัฒนาระบบสารสนเทศ", "จ้างทำของ/จ้างเหมาบริการ", 2567));
    expect(scopeOf(c, 2568)).toBe("other-year");
  });

  test("no year given checks software only", () => {
    const c = classifyRaw(raw("จ้างพัฒนาระบบสารสนเทศ", "จ้างทำของ/จ้างเหมาบริการ", 2567));
    expect(scopeOf(c)).toBe("in-scope");
  });
});

describe("isSoftwareCandidate", () => {
  test("agrees with the full classifier, including '-' and blank columns", () => {
    const cases: RawProject[] = [
      raw("จ้างพัฒนาระบบสารสนเทศเพื่อการบริหารจัดการ", "จ้างทำของ/จ้างเหมาบริการ"),
      raw("ซื้อครุภัณฑ์คอมพิวเตอร์ เครื่องคอมพิวเตอร์", "ซื้อ"),
      raw("เช่าโครงการบริการด้านซอฟต์แวร์ (SaaS) ภายใต้ระบบคลาวด์กลางภาครัฐ", "เช่า"),
      raw("จ้างเหมาทำป้ายไวนิลโครงการพัฒนาระบบการดูแลสุขภาพ", "-"),
      raw("  จ้างพัฒนาแอปพลิเคชันบนมือถือ  ", ""),
    ];
    for (const r of cases) expect(isSoftwareCandidate(r)).toBe(classifyRaw(r).classification.isSoftware);
  });
});

import { parseCaptureInput } from "./ingest.validation.ts";

describe("parseCaptureInput", () => {
  test("keeps 11-digit ids, counts the rest, collapses duplicates", () => {
    const r = parseCaptureInput({
      source: "egp-csv",
      projects: [
        { projectId: "69099316505", title: "  ระบบ  " },
        { projectId: "69099316505", title: "duplicate" },
        { projectId: "6909931650" },
        { projectId: "690993165051" },
        { projectId: "abc" },
        null,
      ],
    });
    expect(r.projects).toEqual([{ projectId: "69099316505", title: "ระบบ", agency: undefined, province: undefined }]);
    // The duplicate is collapsed, not invalid.
    expect(r.invalid).toBe(4);
    expect(r.source).toBe("egp-csv");
  });

  test("rejects a missing array and oversized batches", () => {
    expect(() => parseCaptureInput({})).toThrow("projects must be an array");
    expect(() => parseCaptureInput({ projects: Array(2001).fill({ projectId: "69099316505" }) })).toThrow("at most");
  });
});
