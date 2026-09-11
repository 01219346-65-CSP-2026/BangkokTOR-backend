import { describe, expect, test } from "bun:test";
import { documentRank, triageBundle, triagePdf } from "./triage.ts";
import type { LoadedPdf, LoaderNode } from "./loader.ts";

function pdf(name: string, pages: number, kids: LoaderNode[]): LoadedPdf {
  return { name, path: `/tmp/${name}`, bytes: 1, pages, doc: { "number of pages": pages, kids } };
}

const para = (content: string): LoaderNode => ({ type: "paragraph", content, "page number": 1 });
const heading = (content: string): LoaderNode => ({
  type: "heading",
  content,
  "heading level": 1,
  "page number": 1,
});
const image = (): LoaderNode => ({ type: "image", "page number": 1 });

describe("triagePdf", () => {
  test("a page of Thai text is digital", () => {
    // Measured on real e-GP output: digital documents ran 1,398-2,395 chars/page.
    const t = triagePdf(pdf("doc_1.pdf", 1, [para("ก".repeat(1800))]));
    expect(t.textLayer).toBe("digital");
    expect(t.thaiChars).toBe(1800);
  });

  test("image-only pages are scanned, never digital", () => {
    // The observed scanned case: `image` nodes and exactly zero characters.
    const t = triagePdf(pdf("Attach_TOR_1.pdf", 12, Array.from({ length: 12 }, image)));
    expect(t.textLayer).toBe("scanned");
    expect(t.chars).toBe(0);
  });

  test("a trickle of text over many pages is scanned, not digital", () => {
    // The dangerous case: a scan whose only text is a page-number stamp. Calling
    // this digital would send 40 characters to the grader and score a TOR on them.
    const t = triagePdf(pdf("x.pdf", 40, [para("หน้า ๑"), para("หน้า ๒")]));
    expect(t.textLayer).toBe("scanned");
  });

  test("zero pages is unreadable, not scanned", () => {
    expect(triagePdf(pdf("x.pdf", 0, [])).textLayer).toBe("unreadable");
  });
});

describe("documentRank", () => {
  test("the e-bidding document outranks the announcement and the attachments", () => {
    // Measured: doc_* and annoudoc_* were digital in 4/4 bundles, and the
    // qualification section lives in doc_*.
    expect(documentRank("doc_S314_67119569806.pdf")).toBeLessThan(
      documentRank("annoudoc_S314_67119569806.pdf"),
    );
    expect(documentRank("tor_66129307903_eab.pdf")).toBeLessThan(
      documentRank("Attach_TOR_1.pdf"),
    );
    expect(documentRank("Attach_TOR_1.pdf")).toBeLessThan(documentRank("Attach_PUB_1.pdf"));
  });
});

describe("triageBundle", () => {
  test("readable documents come back best-first and scans are excluded", () => {
    const bundle = triageBundle([
      pdf("Attach_PUB_1.pdf", 1, [para("ก".repeat(600))]),
      pdf("Attach_TOR_1.pdf", 12, Array.from({ length: 12 }, image)),
      pdf("doc_1.pdf", 2, [heading("๒. คุณสมบัติ"), para("ก".repeat(4000))]),
    ]);

    expect(bundle.readable.map((p) => p.name)).toEqual(["doc_1.pdf", "Attach_PUB_1.pdf"]);
    expect(bundle.digital).toBe(2);
    expect(bundle.scanned).toBe(1);
  });

  test("an all-scanned bundle yields nothing readable", () => {
    // This is what must reach `extraction_incomplete` rather than an empty grade.
    const bundle = triageBundle([pdf("a.pdf", 5, Array.from({ length: 5 }, image))]);
    expect(bundle.readable).toHaveLength(0);
    expect(bundle.scanned).toBe(1);
  });
});
