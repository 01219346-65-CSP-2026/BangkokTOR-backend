import { describe, expect, test } from "bun:test";
import { chunkDocuments, chunkPdf } from "./chunk.ts";
import type { LoadedPdf, LoaderNode } from "./loader.ts";

function pdf(name: string, kids: LoaderNode[], pages = 10): LoadedPdf {
  return { name, path: `/tmp/${name}`, bytes: 1, pages, doc: { "number of pages": pages, kids } };
}

const h = (content: string, level: number, page = 1): LoaderNode => ({
  type: "heading",
  content,
  "heading level": level,
  "page number": page,
});
const p = (content: string, page = 1): LoaderNode => ({
  type: "paragraph",
  content,
  "page number": page,
});

describe("chunkPdf", () => {
  test("carries the heading trail so a clause knows which section it is in", () => {
    const chunks = chunkPdf(
      pdf("doc.pdf", [
        h("๒. คุณสมบัติของผู้ยื่นข้อเสนอ", 1),
        p("ก".repeat(500)),
        h("๒.๑๖ มูลค่าสุทธิของกิจการ", 2),
        p("ข".repeat(500)),
      ]),
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.headingPath[0]).toBe("๒. คุณสมบัติของผู้ยื่นข้อเสนอ");
  });

  test("a sibling heading clears the deeper trail rather than accumulating it", () => {
    const chunks = chunkPdf(
      pdf("doc.pdf", [
        h("๒. คุณสมบัติ", 1),
        h("๒.๑ ความสามารถ", 2),
        p("ก".repeat(500)),
        h("๓. หลักฐาน", 1),
        p("ข".repeat(500)),
      ]),
    );

    const last = chunks[chunks.length - 1]!;
    // If level-2 were not cleared, "๒.๑ ความสามารถ" would still be on this path
    // and an evidence quote would be attributed to the wrong section.
    expect(last.headingPath).not.toContain("๒.๑ ความสามารถ");
  });

  test("splits on size when a document has almost no headings", () => {
    // The real case that breaks heading-only chunking: one measured 36-page
    // document carried a single heading and 86,217 characters.
    const chunks = chunkPdf(pdf("tor.pdf", [h("TOR", 1), ...Array.from({ length: 40 }, () => p("ก".repeat(1000)))]));

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.chars).toBeLessThan(12_000);
  });

  test("does not emit a chunk per line for a run of nested headings", () => {
    const chunks = chunkPdf(
      pdf("doc.pdf", [h("๑", 1), h("๑.๑", 2), h("๑.๑.๑", 3), h("๑.๑.๒", 3), p("ก".repeat(300))]),
    );
    expect(chunks).toHaveLength(1);
  });

  test("every chunk names the file it came from", () => {
    const chunks = chunkPdf(pdf("doc_S314.pdf", [h("A", 1), p("ก".repeat(800))]));
    for (const c of chunks) expect(c.filename).toBe("doc_S314.pdf");
  });

  test("a document with no text yields no chunks", () => {
    expect(chunkPdf(pdf("scan.pdf", [{ type: "image", "page number": 1 }]))).toHaveLength(0);
  });

  test("tracks the page range so a quote can be cited", () => {
    const chunks = chunkPdf(pdf("doc.pdf", [h("A", 1, 3), p("ก".repeat(400), 3), p("ข".repeat(400), 5)]));
    expect(chunks[0]!.pageStart).toBe(3);
    expect(chunks[0]!.pageEnd).toBe(5);
  });
});

describe("chunkDocuments", () => {
  test("re-indexes across documents and honours the cost ceiling", () => {
    const many = Array.from({ length: 30 }, () => p("ก".repeat(7000)));
    const chunks = chunkDocuments([pdf("a.pdf", many), pdf("b.pdf", many)], 5);

    expect(chunks).toHaveLength(5);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2, 3, 4]);
  });
});
