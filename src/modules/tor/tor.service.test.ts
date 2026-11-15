import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { env } from "../../config/env.ts";
import { DocumentModel } from "../ingest/document.model.ts";
import type { IngestDocumentLean } from "../ingest/document.model.ts";

const torId = "507f1f77bcf86cd799439011";
const documentId = "507f1f77bcf86cd799439012";
const extractDir = resolve(env.extractDir);
let testDir = "";
let insidePath = "";

const { getDocumentFile } = await import("./tor.service.ts");


// These tests cover getDocumentFile's TOR, document-kind, and path constraints.
beforeAll(async () => {
  await mkdir(extractDir, { recursive: true });
  testDir = await mkdtemp(join(extractDir, "tor-document-file-test-"));
  insidePath = join(testDir, "document.pdf");
  await writeFile(insidePath, "test PDF");
});

afterAll(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
});

function mockDocument(localPath: string) {
  const document = {
    localPath,
    filename: "document.pdf",
  } as IngestDocumentLean;

  return spyOn(DocumentModel, "findOne").mockImplementation(
    () => ({ lean: () => Promise.resolve(document) }) as never,
  );
}

describe("getDocumentFile", () => {
  test("finds only an extracted PDF belonging to the requested TOR", async () => {
    const findOne = mockDocument(insidePath);
    try {
      const result = await getDocumentFile(torId, documentId);

      expect(findOne).toHaveBeenCalledWith({
        _id: documentId,
        torId,
        kind: "extractedPdf",
      });
      expect(result).toEqual({ path: insidePath, filename: "document.pdf" });
    } finally {
      findOne.mockRestore();
    }
  });

  test("rejects a document whose path is outside EXTRACT_DIR", async () => {
    const outsidePath = join(resolve(extractDir, ".."), "outside-document.pdf");
    const findOne = mockDocument(outsidePath);
    try {
      expect(await getDocumentFile(torId, documentId)).toBeNull();
    } finally {
      findOne.mockRestore();
    }
  });

  test("returns null when no extracted PDF matches the TOR and document IDs", async () => {
    const findOne = spyOn(DocumentModel, "findOne").mockImplementation(
      () => ({ lean: () => Promise.resolve(null) }) as never,
    );
    try {
      expect(await getDocumentFile(torId, documentId)).toBeNull();
      expect(findOne).toHaveBeenCalledWith({
        _id: documentId,
        torId,
        kind: "extractedPdf",
      });
    } finally {
      findOne.mockRestore();
    }
  });
});
