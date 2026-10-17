import { describe, expect, test } from "bun:test";
import { exists, load, source } from "./helpers.ts";

// PASSING CRITERIA for feat/91 — the wiring part.
// Run with:   bun test checklist/91
//
// Each test is one box to tick in LEARNING.md; the number is the step.

describe("feat/91 checklist", () => {
  test("step 1: Vertex settings exist, with a safe .env.example", async () => {
    const { env } = await load("src/config/env.ts");
    expect(typeof env.vertexApiKey).toBe("string");
    expect(env.vertexModel).toBe(process.env.VERTEX_MODEL ?? "gemini-2.5-flash");

    const example = source(".env.example");
    expect(example).toContain("VERTEX_MODEL=gemini-2.5-flash");
    // The example must NOT carry a real key — it is committed to git.
    expect(example).toMatch(/^VERTEX_API_KEY=\s*$/m);
  });

  test("step 2: RuleFinding says which PDF, not which chunk", () => {
    const types = source("src/lib/ai/types.ts");
    const ruleFinding = types.slice(types.indexOf("export type RuleFinding"), types.indexOf("export type GradeInput"));
    expect(ruleFinding).toContain("filename");
    expect(ruleFinding).not.toContain("chunkIndex");
    expect(ruleFinding).toContain("checked");
  });

  test("step 2: the Grader takes the whole text, not chunks", () => {
    const types = source("src/lib/ai/types.ts");
    expect(types).toContain("grade(input: GradeInput)");
    expect(types).not.toContain("gradeChunks");
  });

  test("step 7: createGrader() always returns the Vertex grader", async () => {
    const { createGrader } = await load("src/lib/ai/index.ts");
    expect(createGrader().id.startsWith("vertex:")).toBe(true);
  });

  test("step 8: grade.service grades the stored text", () => {
    const service = source("src/modules/grade/grade.service.ts");
    expect(service).toContain(".grade(");
    expect(service).not.toContain("gradeChunks");
    expect(service).toContain("fullText");
  });

  test("step 9: GRADER_VERSION is 2, so every old grade gets redone", async () => {
    const { GRADER_VERSION } = await load("src/modules/tor/tor.model.ts");
    expect(GRADER_VERSION).toBe(2);
  });

  test("step 9: a stored finding records its filename", async () => {
    const { TorModel } = await load("src/modules/tor/tor.model.ts");
    expect(TorModel.schema.path("ruleFindings.filename")).toBeDefined();
  });

  test("step 9: the private grade route shows the filename", async () => {
    const { serializeGrade } = await load("src/modules/tor/tor.serialize.ts");
    const out = serializeGrade({
      _id: "x",
      projectId: "1",
      ruleFindings: [{ code: "PENALTY", fired: true, weight: 3, phase: "fairness", evidence: "ค่าปรับ", checked: true, filename: "doc_1.pdf" }],
    });
    expect(out.findings[0].filename).toBe("doc_1.pdf");
  });

  test("step 10: the chunk router and the Ollama grader are gone", () => {
    expect(exists("src/lib/ai/route.ts"), "delete src/lib/ai/route.ts").toBe(false);
    expect(exists("src/lib/ai/route.test.ts"), "delete src/lib/ai/route.test.ts").toBe(false);
    expect(source("src/lib/ai/ollama.ts")).not.toContain("createOllamaGrader");
  });

  test("step 10: the grade worker checks the key at startup", () => {
    expect(source("src/grade-worker.ts")).toContain("assertVertexConfig");
  });
});
