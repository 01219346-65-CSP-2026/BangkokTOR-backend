import { describe, expect, test } from "bun:test";
import { exists, load, source } from "./helpers.ts";

// PASSING CRITERIA for feat/90 — the wiring part.
// Run with:   bun test checklist/90
//
// Each test is one box to tick in LEARNING.md. They fail on purpose until you
// do the step. Read the test name, then the step with the same number.

describe("feat/90 checklist", () => {
  test("step 1: LoaderNode knows about list items and table rows", () => {
    const loader = source("src/lib/extract/loader.ts");
    expect(loader).toContain(`"list items"?`);
    expect(loader).toContain("rows?");
  });

  test("step 3: tor_texts model exists with the right fields", async () => {
    const { TorTextModel } = await load("src/modules/extract/torText.model.ts");
    const schema = TorTextModel.schema;

    for (const field of ["torId", "projectId", "documentId", "fullText", "chars", "truncated", "files"]) {
      expect(schema.path(field), `missing field: ${field}`).toBeDefined();
    }
    expect(TorTextModel.collection.collectionName).toBe("tor_texts");

    // One text per TOR: a UNIQUE index on torId.
    const unique = schema.indexes().some(
      ([fields, options]: [Record<string, unknown>, { unique?: boolean }]) =>
        fields.torId === 1 && options?.unique === true,
    );
    expect(unique, "add schema.index({ torId: 1 }, { unique: true })").toBe(true);
  });

  test("step 4: MAX_FULLTEXT_CHARS is a setting", async () => {
    const { env } = await load("src/config/env.ts");
    expect(env.maxFulltextChars).toBe(Number(process.env.MAX_FULLTEXT_CHARS ?? 400_000));
    expect(source(".env.example")).toContain("MAX_FULLTEXT_CHARS=");
  });

  test("step 5: extraction saves the whole text instead of chunks", () => {
    const service = source("src/modules/extract/extract.service.ts");
    expect(service).toContain("buildFullText");
    expect(service).toContain("TorTextModel");
    expect(service).toContain("upsert: true");
    expect(service).not.toContain("chunkDocuments");
    expect(service).not.toContain("ChunkModel");
  });

  test("step 5: the extraction queue records textChars, not chunkCount", async () => {
    const { ExtractionQueueModel } = await load("src/modules/extract/extraction.model.ts");
    expect(ExtractionQueueModel.schema.path("textChars")).toBeDefined();
    expect(ExtractionQueueModel.schema.path("chunkCount")).toBeUndefined();
  });

  test("step 6: the TOR detail and the grader read tor_texts", () => {
    expect(source("src/modules/tor/tor.service.ts")).toContain("TorTextModel");
    expect(source("src/modules/grade/grade.service.ts")).toContain("TorTextModel");
  });

  test("step 7: the chunk code is gone", () => {
    for (const path of [
      "src/lib/extract/chunk.ts",
      "src/lib/extract/chunk.test.ts",
      "src/modules/extract/chunk.model.ts",
    ]) {
      expect(exists(path), `delete ${path}`).toBe(false);
    }
  });
});
