import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import { MAX_BULLET_CHARS, MAX_POINTS_PER_SECTION, SUMMARY_SECTIONS } from "./types.ts";
import {
  buildSummaryPrompt,
  createVertexSummarizer,
  parseSummary,
  summarySchema,
} from "./vertexSummary.ts";

// THE SPEC for feat/92.  Run with:   bun test src/lib/ai/vertexSummary.test.ts
//
// The summary comes back under THREE topics — the three cards on the detail
// page: objective (วัตถุประสงค์), scope (ขอบเขตงาน), qualifications
// (คุณสมบัติผู้เสนอราคา). Gemini answers { objective: [...], scope: [...],
// qualifications: [...] }; parseSummary flattens that into bullets tagged
// with their `section`.
//
// Like vertex.test.ts, nothing here reaches Google: `fetch` is replaced by a
// fake that returns a canned Gemini reply.

const text =
  "=== FILE: doc_1.pdf ===\nผู้ยื่นข้อเสนอต้องวางหลักประกัน 46,085,345 บาท\n\n" +
  "=== FILE: Attach_TOR_1.pdf ===\nส่งมอบภายใน 90 วัน";
const files: FileSpan[] = [
  { filename: "doc_1.pdf", pages: 3, start: 0, end: 70 },
  { filename: "Attach_TOR_1.pdf", pages: 5, start: 72, end: text.length },
];

// --- fake fetch (same idea as vertex.test.ts) -------------------------------

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

function fakeFetch(body: unknown) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}
const reply = (json: unknown) => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason: "STOP" }],
});

const settings = env as unknown as Record<string, unknown>;
beforeEach(() => {
  calls = [];
  settings.vertexApiKey = "test-key";
  settings.vertexModel = "gemini-2.5-flash";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------

describe("step 3 — summarySchema", () => {
  const schema = summarySchema(["doc_1.pdf", "Attach_TOR_1.pdf"]) as any;

  test("an OBJECT with one required ARRAY per topic, in page order", () => {
    expect(schema.type).toBe("OBJECT");
    expect(Object.keys(schema.properties)).toEqual([...SUMMARY_SECTIONS]);
    expect(schema.required).toEqual([...SUMMARY_SECTIONS]);
    for (const section of SUMMARY_SECTIONS) {
      expect(schema.properties[section].type).toBe("ARRAY");
      expect(schema.properties[section].maxItems).toBe(MAX_POINTS_PER_SECTION);
    }
  });

  test("each point: length-capped text, and a filename from OUR files only", () => {
    for (const section of SUMMARY_SECTIONS) {
      const item = schema.properties[section].items;
      expect(item.properties.text.type).toBe("STRING");
      expect(item.properties.text.maxLength).toBe(MAX_BULLET_CHARS);
      expect(item.properties.filename.enum).toEqual(["doc_1.pdf", "Attach_TOR_1.pdf"]);
      expect(item.required).toEqual(expect.arrayContaining(["text", "filename"]));
    }
  });
});

describe("step 3 — buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt(text);

  test("contains the whole document", () => {
    expect(prompt).toContain(text);
  });
  test("names all three topics, by their schema keys", () => {
    for (const section of SUMMARY_SECTIONS) expect(prompt).toContain(section);
  });
  test("an absent topic is an empty list, never an invented one", () => {
    expect(prompt).toMatch(/empty list/i);
  });
  test("forbids judging the document (FR-19)", () => {
    expect(prompt).toMatch(/evaluat/i);
    expect(prompt).toMatch(/fair/i);
  });
  test("asks for Thai, with the length limits", () => {
    expect(prompt).toMatch(/Thai/);
    expect(prompt).toContain(String(MAX_BULLET_CHARS));
    expect(prompt).toContain(String(MAX_POINTS_PER_SECTION));
  });
  test("asks which file each point comes from", () => {
    expect(prompt).toMatch(/filename/i);
  });
});

describe("step 3 — parseSummary", () => {
  test("flattens the three topics into tagged bullets, in page order", () => {
    const raw = {
      // Deliberately out of order: the output follows SUMMARY_SECTIONS, not the JSON.
      qualifications: [{ text: "เป็นนิติบุคคลผู้มีอาชีพรับจ้างงานดังกล่าว", filename: "doc_1.pdf" }],
      objective: [{ text: "เพื่อพัฒนาระบบบริการประชาชน", filename: "doc_1.pdf" }],
      scope: [{ text: "  ส่งมอบภายใน 90 วัน ", filename: "Attach_TOR_1.pdf" }],
    };
    expect(parseSummary(raw, files)).toEqual([
      { section: "objective", text: "เพื่อพัฒนาระบบบริการประชาชน", filename: "doc_1.pdf" },
      { section: "scope", text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" },
      { section: "qualifications", text: "เป็นนิติบุคคลผู้มีอาชีพรับจ้างงานดังกล่าว", filename: "doc_1.pdf" },
    ]);
  });

  test("a missing or empty topic is simply absent — the card shows its empty state", () => {
    const raw = { objective: [], scope: [{ text: "ส่งมอบภายใน 90 วัน", filename: "doc_1.pdf" }] };
    expect(parseSummary(raw, files).map((b) => b.section)).toEqual(["scope"]);
  });

  test("a file that is not in the bundle loses its citation, not the point", () => {
    const raw = { scope: [{ text: "ส่งมอบภายใน 90 วัน", filename: "made_up.pdf" }] };
    expect(parseSummary(raw, files)).toEqual([{ section: "scope", text: "ส่งมอบภายใน 90 วัน", filename: null }]);
  });

  test("drops a judgement (FR-19), in any topic", () => {
    const raw = {
      scope: [
        { text: "วางหลักประกัน 5%", filename: "doc_1.pdf" },
        { text: "เงื่อนไขนี้ไม่เป็นธรรมต่อผู้รับจ้าง", filename: "doc_1.pdf" },
      ],
      qualifications: [{ text: "This tender restricts competition.", filename: "doc_1.pdf" }],
    };
    expect(parseSummary(raw, files).map((b) => b.text)).toEqual(["วางหลักประกัน 5%"]);
  });

  test("drops blank and non-string points", () => {
    const raw = { scope: [{ text: "   ", filename: "doc_1.pdf" }, { text: 42 }, null, "x"] };
    expect(parseSummary(raw, files)).toEqual([]);
  });

  test("an unknown topic key is ignored", () => {
    const raw = { advice: [{ text: "ควรยื่นข้อเสนอ", filename: "doc_1.pdf" }] };
    expect(parseSummary(raw, files)).toEqual([]);
  });

  test("stops at MAX_POINTS_PER_SECTION per topic, not overall", () => {
    const many = (label: string) =>
      Array.from({ length: MAX_POINTS_PER_SECTION + 3 }, (_, i) => ({ text: `${label} ข้อที่ ${i}`, filename: "doc_1.pdf" }));
    const out = parseSummary({ scope: many("ขอบเขต"), qualifications: many("คุณสมบัติ") }, files);
    expect(out.filter((b) => b.section === "scope")).toHaveLength(MAX_POINTS_PER_SECTION);
    expect(out.filter((b) => b.section === "qualifications")).toHaveLength(MAX_POINTS_PER_SECTION);
  });

  test("garbage in does not crash", () => {
    for (const raw of [null, undefined, "nope", 3, { scope: "x" }, {}, []]) {
      expect(parseSummary(raw, files)).toEqual([]);
    }
  });
});

describe("step 4 — createVertexSummarizer", () => {
  test("its id names the model", () => {
    expect(createVertexSummarizer().id).toBe("vertex:gemini-2.5-flash");
  });

  test("ONE Gemini call over the whole text; files become the filename enum", async () => {
    fakeFetch(reply({ objective: [], scope: [{ text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" }], qualifications: [] }));
    const out = await createVertexSummarizer().summarize({ text, files });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.contents[0].parts[0].text).toContain(text);
    expect(body.generationConfig.responseSchema.properties.scope.items.properties.filename.enum).toEqual([
      "doc_1.pdf",
      "Attach_TOR_1.pdf",
    ]);
    expect(out).toEqual([{ section: "scope", text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" }]);
  });

  test("no text → no call, no bullets", async () => {
    fakeFetch(reply({}));
    expect(await createVertexSummarizer().summarize({ text: "", files: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
