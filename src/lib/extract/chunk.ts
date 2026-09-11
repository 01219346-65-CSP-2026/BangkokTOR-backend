import { walk, type LoadedPdf } from "./loader.ts";

// Chunking for a grader, not for a search index. The rule that matters: a
// qualification clause must arrive WHOLE, because a rule firing on half a
// sentence is a false positive with a quote to back it up.

export type Chunk = {
  index: number;
  /** Bundle member this text came from — carried so a stored evidence quote
   *  can be traced back to a file and a page, not just to a TOR. */
  filename: string;
  /** Heading trail, outermost first: ["๒. คุณสมบัติของผู้ยื่นข้อเสนอ", "๒.๑๖ ..."]. */
  headingPath: string[];
  text: string;
  chars: number;
  pageStart: number;
  pageEnd: number;
};

// Thai legal text is dense and the model's context is finite. ~6,000 chars is
// roughly 2,000 tokens for Thai script, which is the target the plan sets.
const TARGET_CHARS = 6_000;
// Below this a chunk is a fragment; it gets folded into its neighbour rather
// than spending a model call on a heading and two lines.
const MIN_CHARS = 400;

const TEXT_TYPES = new Set(["paragraph", "list", "table", "caption", "heading"]);

type Block = {
  type: string;
  text: string;
  page: number;
  headingLevel: number | null;
};

function collectBlocks(pdf: LoadedPdf): Block[] {
  const blocks: Block[] = [];
  for (const node of walk(pdf.doc)) {
    if (!node.type || !TEXT_TYPES.has(node.type)) continue;
    const text = normalize(node.content);
    if (!text) continue;
    blocks.push({
      type: node.type,
      text,
      page: node["page number"] ?? 0,
      headingLevel: node.type === "heading" ? (node["heading level"] ?? 1) : null,
    });
  }
  return blocks;
}

// Extraction leaves soft hyphenation and column gutters as runs of spaces
// mid-word. Thai has no inter-word spaces, so collapsing runs is safe and
// makes the model's job (and an evidence quote) cleaner.
function normalize(content: unknown): string {
  if (typeof content !== "string") return "";
  return content.replace(/\s+/g, " ").trim();
}

function headingPathAt(trail: Map<number, string>): string[] {
  return [...trail.entries()].sort((a, b) => a[0] - b[0]).map(([, title]) => title);
}

/**
 * Split one document into grader-sized chunks.
 *
 * Boundaries are preferred at headings so a section stays intact; the size cap
 * is the fallback for documents the loader found few headings in (measured: one
 * 36-page document yielded a single heading, which would otherwise be one
 * 86,000-character chunk).
 */
export function chunkPdf(pdf: LoadedPdf): Chunk[] {
  const blocks = collectBlocks(pdf);
  if (blocks.length === 0) return [];

  const chunks: Chunk[] = [];
  const trail = new Map<number, string>();

  let buffer: string[] = [];
  let chars = 0;
  let pageStart = blocks[0]!.page;
  let pageEnd = blocks[0]!.page;
  let path = headingPathAt(trail);

  const flush = () => {
    if (chars === 0) return;
    chunks.push({
      index: chunks.length,
      filename: pdf.name,
      headingPath: path,
      text: buffer.join("\n"),
      chars,
      pageStart,
      pageEnd,
    });
    buffer = [];
    chars = 0;
  };

  for (const block of blocks) {
    if (block.headingLevel !== null) {
      // A heading ends the previous section — but only once that section is
      // substantial. Otherwise a run of nested headings would emit a chunk per
      // line and blow up the model call count.
      if (chars >= MIN_CHARS) {
        flush();
        pageStart = block.page;
      }

      // Deeper headings never invalidate shallower ones; a sibling or shallower
      // heading clears everything below it.
      for (const level of [...trail.keys()]) {
        if (level >= block.headingLevel) trail.delete(level);
      }
      trail.set(block.headingLevel, block.text);
      if (chars === 0) path = headingPathAt(trail);
    }

    buffer.push(block.text);
    chars += block.text.length + 1;
    pageEnd = block.page;

    if (chars >= TARGET_CHARS) {
      flush();
      pageStart = block.page;
      path = headingPathAt(trail);
    }
  }

  flush();
  return chunks;
}

/**
 * Chunk the readable documents of a bundle, best document first, stopping once
 * `maxChunks` is reached. The cap is a cost ceiling: a 72-page TOR is worth
 * grading, but not at the price of 40 model calls on boilerplate annexes.
 */
export function chunkDocuments(pdfs: LoadedPdf[], maxChunks = 24): Chunk[] {
  const out: Chunk[] = [];
  for (const pdf of pdfs) {
    for (const chunk of chunkPdf(pdf)) {
      if (out.length >= maxChunks) return out;
      out.push({ ...chunk, index: out.length });
    }
  }
  return out;
}
