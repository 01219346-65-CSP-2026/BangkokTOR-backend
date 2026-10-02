import { getNodeContent, walk, type LoadedPdf } from "./loader.ts";

// ============================================================================
// Whole-text extraction — YOU write this file (feat/90). See LEARNING.md.
// ============================================================================
//
// Goal: turn the readable PDFs of one TOR bundle into ONE string, plus a list
// saying where each PDF's text sits inside that string.
//
//   text:
//     === FILE: doc_0800600000_68039035396.pdf ===
//     ประกาศ ...
//     ๒. คุณสมบัติของผู้ยื่นข้อเสนอ
//
//     === FILE: Attach_TOR_1.pdf ===
//     ...
//
//   files:
//     [{ filename: "doc_…pdf",        pages: 12, start: 0,     end: 18234 },
//      { filename: "Attach_TOR_1.pdf", pages: 5,  start: 18236, end: 25010 }]
//
// The tests in fulltext.test.ts are the exact spec. Run them with:
//     bun test src/lib/extract/fulltext.test.ts
//
// The types and constants below are given. The three functions at the bottom
// are yours: delete each `throw` and write the body.
// ============================================================================

/** Where one PDF's text sits inside the combined string. */
export type FileSpan = {
  filename: string;
  pages: number;
  /** Index of the first character of this file's section (its header line). */
  start: number;
  /** Index just AFTER the last character — like String.slice(start, end). */
  end: number;
};

export type FullText = {
  text: string;
  /** text.length */
  chars: number;
  /** true when the size cap cut some text off. */
  truncated: boolean;
  files: FileSpan[];
};

/** Default size cap. Overridable with MAX_FULLTEXT_CHARS in .env. */
export const DEFAULT_MAX_FULLTEXT_CHARS = 400_000;

/** Put between two files' sections. */
export const FILE_SEPARATOR = "\n\n";

/** The line that introduces each PDF inside the combined text. Given. */
export function fileHeader(filename: string): string {
  return `=== FILE: ${filename} ===\n`;
}

/**
 * All readable text of ONE PDF: one line per paragraph / heading / list item /
 * table row, joined with "\n".
 *
 * Hints:
 *   - pdf.doc is a TREE. Every node may have `kids` (more nodes).
 *   - Text lives in THREE places — look at a real file in data/extracted/…/_json:
 *       1. node.content          (paragraph, heading, caption, list item)
 *       2. node["list items"]    (a list: an array of nodes, like kids)
 *       3. node.rows[].cells[]   (a table: each cell is a node with kids)
 *   - Skip nodes with type "image".
 *   - Squash whitespace: content.replace(/\s+/g, " ").trim()
 *   - A table row becomes ONE line: its cells' text joined by " | ".
 *   - Write a helper that calls itself for each child (recursion).
 *   - TypeScript will complain that "list items" and rows are not on
 *     LoaderNode. Add them to the type in loader.ts (step 1 in LEARNING.md).
 */
export function pdfToText(pdf: LoadedPdf): string {
  //throw new Error("TODO(feat/90): pdfToText — see LEARNING.md step 2");
  const pdf_text: string[] = [];

  for (const node of walk(pdf.doc)) {
    pdf_text.push(getNodeContent(node));
  }
  return pdf_text.filter(Boolean).join("\n");
}

/**
 * Join the readable PDFs (already in priority order) into one FullText.
 *
 * Hints, in order:
 *   1. Start with text = "", files = [], truncated = false.
 *   2. For each pdf: body = pdfToText(pdf). Empty body? skip the file.
 *   3. section = fileHeader(pdf.name) + body.
 *   4. Put FILE_SEPARATOR before every section except the first.
 *   5. Would it go past maxChars? Cut the section to fit, set truncated = true,
 *      and stop after this file. If not even the header fits, stop without it.
 *   6. Record { filename, pages, start, end } — start/end are positions in
 *      `text` BEFORE/AFTER you append the section (not counting the separator).
 */
export function buildFullText(
  pdfs: LoadedPdf[],
  maxChars: number = DEFAULT_MAX_FULLTEXT_CHARS,
): FullText {
  const all_pdf_texts: string[] = [];
  const file_spans: FileSpan[] = [];
  let truncated = false;
  let chars = 0;

  //throw new Error("TODO(feat/90): buildFullText — see LEARNING.md step 2");
  for (const pdf of pdfs) {
    const pdf_text = pdfToText(pdf);
    if (!pdf_text) continue;
    const header = fileHeader(pdf.name);
    const section = header + pdf_text;
    const separatorLength = all_pdf_texts.length > 0 ? FILE_SEPARATOR.length : 0;
    const available = maxChars - chars - separatorLength;

    if (available < header.length) {
      truncated = true;
      break;
    }

    const includedSection = section.slice(0, available);
    all_pdf_texts.push(includedSection);
    const start = chars + separatorLength;
    const end = start + includedSection.length;
    file_spans.push({
      filename: pdf.name,
      pages: pdf.pages,
      start,
      end,
    });
    chars = end;

    if (includedSection.length < section.length) {
      truncated = true;
      break;
    }
  }

  const full_text = all_pdf_texts.join(FILE_SEPARATOR);

  return {
    text: full_text,
    chars: full_text.length,
    truncated,
    files: file_spans,
  };
}

/**
 * Which file does character position `offset` belong to? null if none
 * (e.g. offset is -1, which is what text.indexOf returns for "not found").
 *
 * Hint: files.find(...) with start <= offset < end.
 */
export function fileAt(files: FileSpan[], offset: number): string | null {
  //throw new Error("TODO(feat/90): fileAt — see LEARNING.md step 2");
  for (const span of files) {
    if (offset < span.start) {
      return null;
    }
    else if (offset >= span.start && offset < span.end) {
      return span.filename;
    }
  }

  return null;
}
