import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { env } from "../../config/env.ts";
import type { FileSpan } from "../extract/fulltext.ts";
import { locateQuote, MAX_EVIDENCE_CHARS, type RuleSpec } from "./types.ts";
import {
  buildGradePrompt,
  callGemini,
  createVertexGrader,
  gradeSchema,
  keepVerifiedFindings,
} from "./vertex.ts";

// THE SPEC for feat/91.  Run with:   bun test src/lib/ai/vertex.test.ts
//
// None of these tests reach Google. Where a test needs Gemini to "answer", it
// replaces the global `fetch` with a fake that returns a canned reply — so the
// tests are free, fast, and work without a key.

const PENALTY: RuleSpec = {
  code: "PENALTY",
  definition: "A clause setting a fine for late delivery.",
  unfairWhen: "the daily rate exceeds 0.2% of the contract value.",
  cues: ["ค่าปรับ", "อัตราร้อยละ"],
};
const NOENTITY: RuleSpec = {
  code: "NOENTITY",
  definition: "The document does not require the bidder to be a juristic person.",
  cues: ["นิติบุคคล"],
};

// A tiny two-file TOR text, in the exact shape feat/90's buildFullText makes.
const H1 = "=== FILE: doc_1.pdf ===\n";
const H2 = "=== FILE: Attach_TOR_1.pdf ===\n";
const BODY1 = "ผู้ยื่นข้อเสนอต้องเป็นนิติบุคคล";
const BODY2 = "ผู้รับจ้างต้องชำระค่าปรับวันละ 0.5% ของราคาจ้าง";
const text = H1 + BODY1 + "\n\n" + H2 + BODY2;
const files: FileSpan[] = [
  { filename: "doc_1.pdf", pages: 3, start: 0, end: (H1 + BODY1).length },
  { filename: "Attach_TOR_1.pdf", pages: 5, start: (H1 + BODY1).length + 2, end: text.length },
];

// --- fake fetch -------------------------------------------------------------

type Call = { url: string; init: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Make the next fetch() calls answer with `body` and HTTP `status`. */
function fakeFetch(body: unknown, status = 200) {
  globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
}

/** A successful Gemini reply whose text is `json`. */
const reply = (json: unknown, finishReason = "STOP") => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] }, finishReason }],
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

describe("step 3 — locateQuote", () => {
  test("finds an exact match", () => {
    expect(locateQuote("world", "hello world")).toBe(6);
  });
  test("finds a match that differs only by whitespace, at its ORIGINAL position", () => {
    // "hel  lo   world": the "l" that starts "lo wor" sits at index 5.
    expect(locateQuote("lo wor", "hel  lo   world")).toBe(5);
  });
  test("-1 when missing or blank", () => {
    expect(locateQuote("xyz", "hello")).toBe(-1);
    expect(locateQuote("   ", "hello")).toBe(-1);
  });
});

describe("step 4 — callGemini", () => {
  const schema = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } };

  test("POSTs the prompt to the express-mode URL with the key", async () => {
    fakeFetch(reply({ ok: true }));
    await callGemini({ prompt: "hello", schema });

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(
      "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=test-key",
    );
    expect(init.method).toBe("POST");
  });

  test("sends the prompt, temperature 0, and the JSON schema", async () => {
    fakeFetch(reply({ ok: true }));
    await callGemini({ prompt: "hello", schema });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.contents[0].parts[0].text).toBe("hello");
    expect(body.generationConfig.temperature).toBe(0);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema).toEqual(schema);
  });

  test("returns the answer parsed from JSON", async () => {
    fakeFetch(reply({ ok: true, n: 3 }));
    expect(await callGemini<Record<string, unknown>>({ prompt: "hello", schema })).toEqual({ ok: true, n: 3 });
  });

  test("throws on an HTTP error, without leaking the key", async () => {
    fakeFetch({ error: { message: "API key not valid" } }, 403);
    const error = await callGemini({ prompt: "x", schema }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("403");
    expect((error as Error).message).not.toContain("test-key");
  });

  test("throws when the prompt was blocked", async () => {
    fakeFetch({ promptFeedback: { blockReason: "SAFETY" } });
    await expect(callGemini({ prompt: "x", schema })).rejects.toThrow();
  });

  test("throws when the answer was cut off (finishReason is not STOP)", async () => {
    fakeFetch(reply({ ok: true }, "MAX_TOKENS"));
    await expect(callGemini({ prompt: "x", schema })).rejects.toThrow();
  });

  test("throws when the answer is not valid JSON", async () => {
    fakeFetch({ candidates: [{ content: { parts: [{ text: "{not json" }] }, finishReason: "STOP" }] });
    await expect(callGemini({ prompt: "x", schema })).rejects.toThrow();
  });

  test("with no key: a clear error, and Google is never called", async () => {
    settings.vertexApiKey = "";
    fakeFetch(reply({ ok: true }));
    await expect(callGemini({ prompt: "x", schema })).rejects.toThrow("VERTEX_API_KEY");
    expect(calls).toHaveLength(0);
  });
});

describe("step 5 — gradeSchema", () => {
  const schema = gradeSchema(["PENALTY", "NOENTITY"]) as any;
  const item = schema.properties.findings.items;

  test("an OBJECT with a findings ARRAY", () => {
    expect(schema.type).toBe("OBJECT");
    expect(schema.properties.findings.type).toBe("ARRAY");
    expect(schema.required).toContain("findings");
  });
  test("each finding: code (enum of OUR codes), present, quote (length-capped)", () => {
    expect(item.properties.code.enum).toEqual(["PENALTY", "NOENTITY"]);
    expect(item.properties.present.type).toBe("BOOLEAN");
    expect(item.properties.quote.type).toBe("STRING");
    expect(item.properties.quote.maxLength).toBe(MAX_EVIDENCE_CHARS);
    expect(item.required).toEqual(expect.arrayContaining(["code", "present", "quote"]));
  });
});

describe("step 5 — buildGradePrompt", () => {
  const prompt = buildGradePrompt([PENALTY, NOENTITY], text);

  test("DEFINES every rule instead of just naming it", () => {
    expect(prompt).toContain("[PENALTY]");
    expect(prompt).toContain(PENALTY.definition);
    expect(prompt).toContain("[NOENTITY]");
    expect(prompt).toContain(NOENTITY.definition);
  });
  test("includes the unfairness condition and the Thai cue words", () => {
    expect(prompt).toContain(PENALTY.unfairWhen!);
    expect(prompt).toContain("ค่าปรับ");
    expect(prompt).toContain("อัตราร้อยละ");
  });
  test("asks for a WORD-FOR-WORD quote with a length limit", () => {
    expect(prompt).toContain("WORD-FOR-WORD");
    expect(prompt).toContain(String(MAX_EVIDENCE_CHARS));
  });
  test("contains the whole document", () => {
    expect(prompt).toContain(text);
  });
});

describe("step 5 — keepVerifiedFindings", () => {
  test("a real quote fires, and is traced to the PDF it came from", () => {
    const raw = { findings: [{ code: "PENALTY", present: true, quote: "ชำระค่าปรับวันละ 0.5%" }] };
    expect(keepVerifiedFindings(raw, [PENALTY], text, files)).toEqual([
      {
        code: "PENALTY",
        fired: true,
        evidence: "ชำระค่าปรับวันละ 0.5%",
        checked: true,
        filename: "Attach_TOR_1.pdf",
      },
    ]);
  });

  test("an invented quote is thrown away — not fired, not checked", () => {
    const raw = { findings: [{ code: "PENALTY", present: true, quote: "ค่าปรับวันละ 5%" }] };
    expect(keepVerifiedFindings(raw, [PENALTY], text, files)[0]).toMatchObject({
      fired: false,
      evidence: "",
      checked: false,
      filename: null,
    });
  });

  test("present=false is a checked non-finding", () => {
    const raw = { findings: [{ code: "NOENTITY", present: false, quote: "" }] };
    expect(keepVerifiedFindings(raw, [NOENTITY], text, files)[0]).toMatchObject({
      code: "NOENTITY",
      fired: false,
      checked: true,
    });
  });

  test("a rule the model skipped is unchecked — never a pass", () => {
    const out = keepVerifiedFindings({ findings: [] }, [PENALTY, NOENTITY], text, files);
    expect(out.map((f) => f.code)).toEqual(["PENALTY", "NOENTITY"]);
    expect(out.every((f) => !f.fired && !f.checked)).toBe(true);
  });

  test("codes we did not ask about are ignored", () => {
    const raw = {
      findings: [
        { code: "MADE_UP", present: true, quote: "นิติบุคคล" },
        { code: "NOENTITY", present: false, quote: "" },
      ],
    };
    expect(keepVerifiedFindings(raw, [NOENTITY], text, files).map((f) => f.code)).toEqual(["NOENTITY"]);
  });

  test("garbage in does not crash", () => {
    for (const raw of [null, "nope", { findings: "x" }, { findings: [null, 3, { present: true }] }]) {
      const out = keepVerifiedFindings(raw, [PENALTY], text, files);
      expect(out).toHaveLength(1);
      expect(out[0]!.fired).toBe(false);
    }
  });

  test("a quote that differs only in spacing still counts", () => {
    const raw = { findings: [{ code: "PENALTY", present: true, quote: "ชำระค่าปรับ  วันละ 0.5%" }] };
    expect(keepVerifiedFindings(raw, [PENALTY], text, files)[0]).toMatchObject({
      fired: true,
      filename: "Attach_TOR_1.pdf",
    });
  });
});

describe("step 6 — createVertexGrader", () => {
  test("its id names the model", () => {
    expect(createVertexGrader().id).toBe("vertex:gemini-2.5-flash");
  });

  test("ONE Gemini call for all the rules, answer verified", async () => {
    fakeFetch(
      reply({
        findings: [
          { code: "PENALTY", present: true, quote: "ชำระค่าปรับวันละ 0.5%" },
          { code: "NOENTITY", present: false, quote: "" },
        ],
      }),
    );
    const out = await createVertexGrader().grade({ rules: [PENALTY, NOENTITY], text, files });

    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.contents[0].parts[0].text).toContain("[PENALTY]");
    expect(body.generationConfig.responseSchema.properties.findings.items.properties.code.enum).toEqual([
      "PENALTY",
      "NOENTITY",
    ]);
    expect(out).toEqual([
      { code: "PENALTY", fired: true, evidence: "ชำระค่าปรับวันละ 0.5%", checked: true, filename: "Attach_TOR_1.pdf" },
      { code: "NOENTITY", fired: false, evidence: "", checked: true, filename: null },
    ]);
  });

  test("no rules → no call", async () => {
    fakeFetch(reply({ findings: [] }));
    expect(await createVertexGrader().grade({ rules: [], text, files })).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
