import { describe, expect, test } from "bun:test";
import { exists, load, source } from "./helpers.ts";

// PASSING CRITERIA for feat/92 — the wiring part.
// Run with:   bun test checklist/92
//
// Each test is one box to tick in LEARNING.md; the number is the step.

describe("feat/92 checklist", () => {
  test("step 1: a SummaryBullet names its file, not a chunk", () => {
    const types = source("src/lib/ai/types.ts");
    const bullet = types.slice(types.indexOf("export type SummaryBullet"), types.indexOf("export type SummaryInput"));
    expect(bullet).toContain("filename");
    expect(bullet).not.toContain("chunkIndex");
  });

  test("step 1: the summarizer reads the whole text — chunk types are gone", () => {
    const types = source("src/lib/ai/types.ts");
    expect(types).not.toContain("GradeChunk");
    expect(types).not.toContain("MAX_SUMMARY_CHUNKS");
    const input = types.slice(types.indexOf("export type SummaryInput"));
    expect(input.slice(0, input.indexOf(";") + 1)).not.toContain("chunks");
  });

  test("step 2: sanitizeBullets keeps the filename", async () => {
    const { sanitizeBullets } = await load("src/lib/ai/summaryGuard.ts");
    expect(sanitizeBullets([{ text: "ส่งมอบภายใน 90 วัน", filename: "doc_1.pdf" }])).toEqual([
      { text: "ส่งมอบภายใน 90 วัน", filename: "doc_1.pdf" },
    ]);
  });

  test("step 5: createSummarizer() always returns the Vertex summarizer", async () => {
    const { createSummarizer } = await load("src/lib/ai/index.ts");
    expect(createSummarizer().id).toBe(`vertex:${process.env.VERTEX_MODEL ?? "gemini-2.5-flash"}`);
  });

  test("step 6: grade.service summarizes the stored text directly", () => {
    const service = source("src/modules/grade/grade.service.ts");
    expect(service).toMatch(/summarize\(\{\s*text,\s*files\s*\}\)/);
    expect(service).not.toContain("GradeChunk");
  });

  test("step 7: SUMMARY_VERSION is 2 and a stored bullet has a filename", async () => {
    const { SUMMARY_VERSION, TorModel } = await load("src/modules/tor/tor.model.ts");
    expect(SUMMARY_VERSION).toBe(2);
    expect(TorModel.schema.path("summaryBullets.filename")).toBeDefined();
  });

  test("step 9: Ollama is gone", async () => {
    expect(exists("src/lib/ai/ollama.ts"), "delete src/lib/ai/ollama.ts").toBe(false);
    const { env } = await load("src/config/env.ts");
    expect(env.ollamaUrl).toBeUndefined();
    expect(env.ollamaModel).toBeUndefined();
    expect(env.aiProvider).toBeUndefined();
    expect(source(".env.example")).not.toContain("OLLAMA");
  });

  test("step 9: the placeholder summarizer in vertex.ts is gone", () => {
    expect(source("src/lib/ai/vertex.ts")).not.toContain("createVertexSummarizer");
  });
});
