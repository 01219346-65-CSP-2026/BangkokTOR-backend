import { describe, expect, test } from "bun:test";
import { buildFullText, fileAt, fileHeader, pdfToText } from "./fulltext.ts";
import type { LoadedPdf, LoaderNode } from "./loader.ts";

// Run just this file with:   bun test src/lib/extract/fulltext.test.ts
//
// Each test builds a tiny fake PDF (the same JSON shape loader.ts produces)
// and checks what buildFullText does with it.

function pdf(name: string, kids: LoaderNode[], pages = 3): LoadedPdf {
  return { name, path: `/tmp/${name}`, bytes: 1, pages, doc: { "number of pages": pages, kids } };
}

const p = (content: string): LoaderNode => ({ type: "paragraph", content, "page number": 1 });
const h = (content: string): LoaderNode => ({ type: "heading", content, "heading level": 1 });

describe("pdfToText", () => {
  test("keeps paragraphs and headings in reading order, one per line", () => {
    expect(pdfToText(pdf("a.pdf", [h("๒. คุณสมบัติ"), p("ต้องเป็นนิติบุคคล")]))).toBe(
      "๒. คุณสมบัติ\nต้องเป็นนิติบุคคล",
    );
  });

  test("squashes runs of whitespace left by column gutters", () => {
    expect(pdfToText(pdf("a.pdf", [p("  ผู้ยื่น    ข้อเสนอ \n ")]))).toBe("ผู้ยื่น ข้อเสนอ");
  });

  test("reads list items — the old chunker dropped these", () => {
    const list: LoaderNode = {
      type: "list",
      "list items": [
        { type: "list item", content: "1.1 มีผลงานไม่น้อยกว่า 5 ปี" },
        { type: "list item", content: "1.2 ไม่เป็นผู้ทิ้งงาน", kids: [p("ต่อเนื่อง")] },
      ],
    };
    expect(pdfToText(pdf("a.pdf", [list]))).toBe(
      "1.1 มีผลงานไม่น้อยกว่า 5 ปี\n1.2 ไม่เป็นผู้ทิ้งงาน\nต่อเนื่อง",
    );
  });

  test("reads tables one row per line, cells joined by |", () => {
    const table: LoaderNode = {
      type: "table",
      rows: [
        { cells: [{ type: "table cell", kids: [p("ลำดับ")] }, { type: "table cell", kids: [p("รายการ")] }] },
        { cells: [{ type: "table cell", kids: [p("1")] }, { type: "table cell", kids: [p("ป้ายจราจร")] }] },
      ],
    };
    expect(pdfToText(pdf("a.pdf", [table]))).toBe("ลำดับ | รายการ\n1 | ป้ายจราจร");
  });

  test("ignores images", () => {
    expect(pdfToText(pdf("a.pdf", [{ type: "image" }, p("ข้อความ")]))).toBe("ข้อความ");
  });
});

describe("buildFullText", () => {
  test("every file starts with a header naming it", () => {
    const out = buildFullText([pdf("doc_1.pdf", [p("หนึ่ง")]), pdf("Attach_TOR_1.pdf", [p("สอง")])]);
    expect(out.text).toContain(fileHeader("doc_1.pdf") + "หนึ่ง");
    expect(out.text).toContain(fileHeader("Attach_TOR_1.pdf") + "สอง");
    // Order is kept exactly as given (triage already sorted best-first).
    expect(out.text.indexOf("หนึ่ง")).toBeLessThan(out.text.indexOf("สอง"));
    expect(out.chars).toBe(out.text.length);
    expect(out.truncated).toBe(false);
  });

  test("files[] offsets point at each file's own section", () => {
    const out = buildFullText([pdf("a.pdf", [p("AAA")], 4), pdf("b.pdf", [p("BBB")], 7)]);
    expect(out.files).toHaveLength(2);
    const [a, b] = out.files;
    expect(out.text.slice(a!.start, a!.end)).toBe(fileHeader("a.pdf") + "AAA");
    expect(out.text.slice(b!.start, b!.end)).toBe(fileHeader("b.pdf") + "BBB");
    expect(a!.pages).toBe(4);
    expect(b!.pages).toBe(7);
  });

  test("a PDF with no text is skipped entirely — no empty header", () => {
    const out = buildFullText([pdf("empty.pdf", [{ type: "image" }]), pdf("b.pdf", [p("BBB")])]);
    expect(out.text).not.toContain("empty.pdf");
    expect(out.files.map((f) => f.filename)).toEqual(["b.pdf"]);
  });

  test("no PDFs means empty text, not a crash", () => {
    expect(buildFullText([])).toEqual({ text: "", chars: 0, truncated: false, files: [] });
  });

  test("the size cap cuts the text and says so", () => {
    const out = buildFullText([pdf("a.pdf", [p("ก".repeat(500))]), pdf("b.pdf", [p("ข".repeat(500))])], 300);
    expect(out.chars).toBeLessThanOrEqual(300);
    expect(out.truncated).toBe(true);
    // The first (most important) file survives; the second never started.
    expect(out.files.map((f) => f.filename)).toEqual(["a.pdf"]);
  });
});

describe("fileAt", () => {
  test("maps a quote's position back to the file it came from", () => {
    const out = buildFullText([pdf("a.pdf", [p("ค่าปรับวันละ 0.1%")]), pdf("b.pdf", [p("ยื่นซอง 5%")])]);
    expect(fileAt(out.files, out.text.indexOf("ค่าปรับ"))).toBe("a.pdf");
    expect(fileAt(out.files, out.text.indexOf("ยื่นซอง"))).toBe("b.pdf");
    // indexOf returns -1 when a quote is not found.
    expect(fileAt(out.files, -1)).toBeNull();
  });
});
