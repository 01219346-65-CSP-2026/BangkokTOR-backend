import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import { publicSourceUrl, serialize, serializeDetail, serializeGrade } from "./tor.serialize.ts";
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
      { code: "IDMISMATCH", fired: true, weight: 4, phase: "legitimacy", evidence: "กรมอื่น", checked: true },
      { code: "PENALTY", fired: true, weight: 3, phase: "fairness", evidence: "ค่าปรับวันละ", checked: true },
      { code: "HOURS", fired: false, weight: 3, phase: "fairness", evidence: "", checked: true },
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
          { code: "NOT_A_RULE", fired: true, weight: 9, phase: "fairness", evidence: "x", checked: true },
        ],
      }),
    );
    expect(out.signals).toEqual([]);
  });
});

// Fixture for serializeDetail: a stored tor_texts row. Only documentId and
// files are read by the serializer; fullText is here to prove it never ships.
const BUNDLE_ID = new Types.ObjectId();
function text(overrides: Record<string, unknown> = {}) {
  return {
    documentId: BUNDLE_ID,
    fullText: "=== FILE: doc_S50610000092.pdf ===\nผู้ยื่นข้อเสนอต้องมีผลงานการดำเนินโครงการไม่น้อยกว่า 5 ปี",
    files: [
      { filename: "doc_S50610000092.pdf", pages: 12, start: 0, end: 90 },
      { filename: "Attach_TOR_1.pdf", pages: 5, start: 92, end: 200 },
    ],
    ...overrides,
  } as never;
}

describe("serializeDetail — summary points", () => {
  test("emits summary points and no document text at all", () => {
    const out = serializeDetail(
      tor({
        summaryBullets: [{ section: "scope", text: "กำหนดยื่นข้อเสนอภายใน 11 ม.ค. 2568", filename: "doc_S50610000092.pdf" }],
      }),
      [],
      text(),
    );

    expect(out.summaryPoints).toHaveLength(1);
    // The stored full text must not ship — the PDF is linked instead.
    const json = JSON.stringify(out);
    expect(json).not.toContain("ผู้ยื่นข้อเสนอต้องมีผลงาน");
    expect(json).not.toContain("extractedSections");
  });

  test("a point cites the PDF the summarizer tagged it with", () => {
    const out = serializeDetail(
      tor({
        summaryBullets: [{ section: "qualifications", text: "วางหลักประกันซองร้อยละ 5", filename: "doc_S50610000092.pdf" }],
      }),
      [],
      text(),
    );

    expect(out.summaryPoints[0]).toMatchObject({
      section: "qualifications",
      text: "วางหลักประกันซองร้อยละ 5",
      filename: "doc_S50610000092.pdf",
      pageStart: 0,
      pageEnd: 0,
    });
  });

  test("each point says which card it belongs to; an old row's points have none", () => {
    const out = serializeDetail(
      tor({
        summaryBullets: [
          { section: "objective", text: "เพื่อพัฒนาระบบบริการประชาชน", filename: null },
          { text: "กำหนดส่งมอบภายใน 180 วัน" }, // SUMMARY_VERSION 1: no section
        ],
      }),
      [],
      text(),
    );
    expect(out.summaryPoints.map((p) => p.section)).toEqual(["objective", null]);
  });

  test("a point without a file keeps its text but has no citation", () => {
    const out = serializeDetail(
      tor({ summaryBullets: [{ section: "scope", text: "กำหนดส่งมอบภายใน 180 วัน", filename: null }] }),
      [],
      text(),
    );
    expect(out.summaryPoints[0]).toMatchObject({ text: "กำหนดส่งมอบภายใน 180 วัน", filename: null });
  });

  test("an evaluative bullet never reaches the public shape", () => {
    // The screen runs at generation and before the write, so a stored bullet
    // like this should be impossible — which is exactly why the gate re-checks
    // rather than trusting its input. Rows from an older SUMMARY_VERSION, or a
    // future caller that forgets, are caught here.
    const out = serializeDetail(
      tor({
        summaryBullets: [
          { section: "scope", text: "กำหนดส่งมอบภายใน 180 วัน", filename: "doc_S50610000092.pdf" },
          { section: "scope", text: "เงื่อนไขนี้ไม่เป็นธรรมต่อผู้รับจ้าง", filename: "doc_S50610000092.pdf" },
          { section: "qualifications", text: "This tender restricts competition.", filename: "doc_S50610000092.pdf" },
        ],
      }),
      [],
      text(),
    );

    expect(out.summaryPoints).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("ไม่เป็นธรรม");
  });

  test("a TOR with no summary serializes an empty list rather than throwing", () => {
    expect(serializeDetail(tor({ summaryBullets: [] }), [], null).summaryPoints).toEqual([]);
    // Rows predating the field entirely.
    expect(serializeDetail(tor({ summaryBullets: undefined }), [], null).summaryPoints).toEqual([]);
  });

  test("a bundle's page count is the sum of its readable PDFs", () => {
    const bundle = {
      _id: BUNDLE_ID,
      kind: "bundle",
      filename: "bundle.zip",
      url: "https://example.test/bundle.zip",
      textLayer: "digital",
      fetchedAt: null,
    } as never;
    const out = serializeDetail(tor(), [bundle], text());
    expect(out.documents[0]!.pages).toBe(17);
    // No stored text yet: 0 pages, not a crash.
    expect(serializeDetail(tor(), [bundle], null).documents[0]!.pages).toBe(0);
  });

  test("the grade stays private on the detail shape too", () => {
    const json = JSON.stringify(serializeDetail(tor(), [], text()));
    expect(json).not.toContain("gradeScore");
    expect(json).not.toContain("42.5");
    expect(json).not.toContain("กรมอื่น");
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

describe("serialize — required skills", () => {
  test("emits slug and quote, not the tagger's bookkeeping", () => {
    const out = serialize(
      tor({
        requiredSkills: [{ slug: "react", source: "keyword", evidence: "ใช้ React" }],
        skillTaggerVersion: 1,
      }),
    ) as Record<string, unknown>;
    expect(out.requiredSkills).toEqual([{ slug: "react", evidence: "ใช้ React" }]);
    expect(out.skillTaggerVersion).toBeUndefined();
  });

  test("an untagged TOR has an empty list, not a missing field", () => {
    expect(serialize(tor()).requiredSkills).toEqual([]);
  });
});

describe("publicSourceUrl", () => {
  const NEW = "https://process5.gprocurement.go.th/egp-agpc01-web/announcement?keywordSearch=67119569806";

  test("rewrites the retired process3 link to the announcement search", () => {
    const old =
      "https://process3.gprocurement.go.th/egp2procmainWeb/jsp/procsearch.sch?announceType=&proj_id=67119569806";
    expect(serialize(tor({ sourceUrl: old })).sourceUrl).toBe(NEW);
  });

  test("fills an e-GP row that has no link at all", () => {
    expect(publicSourceUrl({ sourceId: "ckan-egp", projectId: "67119569806", sourceUrl: "" })).toBe(NEW);
  });

  test("leaves other sources' links alone", () => {
    const url = "https://egp2.bangkok.go.th/project-detail/abc";
    expect(publicSourceUrl({ sourceId: "bangkok-egp2", projectId: "x", sourceUrl: url })).toBe(url);
  });
});

describe("serializeDetail — extracted PDF links", () => {
  const EGP_ZIP = "https://process5.gprocurement.go.th/egp-upload-service/v1/downloadFileTest?fileId=abc";

  function pdf(localPath: string | null) {
    return {
      _id: new Types.ObjectId(),
      kind: "extractedPdf",
      filename: "tor.pdf",
      url: EGP_ZIP,
      localPath,
    } as unknown as Parameters<typeof serializeDetail>[1][number];
  }

  test("a PDF still on disk is served by our own route", () => {
    const t = tor();
    const [doc] = serializeDetail(t, [pdf("./data/extracted/1/tor.pdf")], null).documents;
    expect(doc!.url).toBe(`/api/tors/${String(t._id)}/documents/${doc!.id}/file`);
  });

  test("once extraction has deleted it, the row links to the e-GP bundle", () => {
    const [doc] = serializeDetail(tor(), [pdf(null)], null).documents;
    expect(doc!.url).toBe(EGP_ZIP);
  });
});
