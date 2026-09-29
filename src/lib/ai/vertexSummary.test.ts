import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import { MAX_BULLET_CHARS, MAX_BULLETS } from "./types.ts";
import {
  buildSummaryPrompt,
  createVertexSummarizer,
  parseSummary,
  summarySchema,
} from "./vertexSummary.ts";

// THE SPEC for feat/92.  Run with:   bun test src/lib/ai/vertexSummary.test.ts
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
  const item = schema.properties.points.items;

  test("an OBJECT with a points ARRAY of at most MAX_BULLETS", () => {
    expect(schema.type).toBe("OBJECT");
    expect(schema.required).toContain("points");
    expect(schema.properties.points.type).toBe("ARRAY");
    expect(schema.properties.points.maxItems).toBe(MAX_BULLETS);
  });

  test("each point: length-capped text, and a filename from OUR files only", () => {
    expect(item.properties.text.type).toBe("STRING");
    expect(item.properties.text.maxLength).toBe(MAX_BULLET_CHARS);
    expect(item.properties.filename.enum).toEqual(["doc_1.pdf", "Attach_TOR_1.pdf"]);
    expect(item.required).toEqual(expect.arrayContaining(["text", "filename"]));
  });
});

describe("step 3 — buildSummaryPrompt", () => {
  const prompt = buildSummaryPrompt(text);

  test("contains the whole document", () => {
    expect(prompt).toContain(text);
  });
  test("forbids judging the document (FR-19)", () => {
    expect(prompt).toMatch(/evaluat/i);
    expect(prompt).toMatch(/fair/i);
  });
  test("asks for Thai, with the length limits", () => {
    expect(prompt).toMatch(/Thai/);
    expect(prompt).toContain(String(MAX_BULLET_CHARS));
    expect(prompt).toContain(String(MAX_BULLETS));
  });
  test("asks which file each point comes from", () => {
    expect(prompt).toMatch(/filename/i);
  });
});

describe("step 3 — parseSummary", () => {
  test("keeps a descriptive point and its file", () => {
    const raw = { points: [{ text: "  ส่งมอบภายใน 90 วัน ", filename: "Attach_TOR_1.pdf" }] };
    expect(parseSummary(raw, files)).toEqual([{ text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" }]);
  });

  test("a file that is not in the bundle loses its citation, not the point", () => {
    const raw = { points: [{ text: "ส่งมอบภายใน 90 วัน", filename: "made_up.pdf" }] };
    expect(parseSummary(raw, files)).toEqual([{ text: "ส่งมอบภายใน 90 วัน", filename: null }]);
  });

  test("drops a judgement (FR-19)", () => {
    const raw = {
      points: [
        { text: "วางหลักประกัน 5%", filename: "doc_1.pdf" },
        { text: "เงื่อนไขนี้ไม่เป็นธรรมต่อผู้รับจ้าง", filename: "doc_1.pdf" },
        { text: "This tender restricts competition.", filename: "doc_1.pdf" },
      ],
    };
    expect(parseSummary(raw, files).map((b) => b.text)).toEqual(["วางหลักประกัน 5%"]);
  });

  test("drops blank and non-string points", () => {
    const raw = { points: [{ text: "   ", filename: "doc_1.pdf" }, { text: 42 }, null, "x"] };
    expect(parseSummary(raw, files)).toEqual([]);
  });

  test("stops at MAX_BULLETS", () => {
    const raw = {
      points: Array.from({ length: MAX_BULLETS + 4 }, (_, i) => ({ text: `ข้อกำหนดที่ ${i}`, filename: "doc_1.pdf" })),
    };
    expect(parseSummary(raw, files)).toHaveLength(MAX_BULLETS);
  });

  test("garbage in does not crash", () => {
    for (const raw of [null, undefined, "nope", 3, { points: "x" }, {}]) {
      expect(parseSummary(raw, files)).toEqual([]);
    }
  });
});

describe("step 4 — createVertexSummarizer", () => {
  test("its id names the model", () => {
    expect(createVertexSummarizer().id).toBe("vertex:gemini-2.5-flash");
  });

  test("ONE Gemini call over the whole text; files become the filename enum", async () => {
    fakeFetch(reply({ points: [{ text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" }] }));
    const out = await createVertexSummarizer().summarize({ text, files });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.contents[0].parts[0].text).toContain(text);
    expect(body.generationConfig.responseSchema.properties.points.items.properties.filename.enum).toEqual([
      "doc_1.pdf",
      "Attach_TOR_1.pdf",
    ]);
    expect(out).toEqual([{ text: "ส่งมอบภายใน 90 วัน", filename: "Attach_TOR_1.pdf" }]);
  });

  test("no text → no call, no bullets", async () => {
    fakeFetch(reply({ points: [] }));
    expect(await createVertexSummarizer().summarize({ text: "", files: [] })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
