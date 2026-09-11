import { walk, type LoadedPdf } from "./loader.ts";

// AGENTS.md §4.1 stage ④. This is where the OCR bill is routed: a scanned PDF
// is identified BEFORE anything tries to grade it, so it is recorded as
// incomplete rather than silently producing an empty grade.

export type TextLayer = "digital" | "scanned" | "unreadable";

export type Triage = {
  textLayer: TextLayer;
  pages: number;
  chars: number;
  thaiChars: number;
  charsPerPage: number;
  headings: number;
};

// Measured on 18 real e-GP PDFs across 4 bundles: digital documents ran
// 1,398–2,395 chars/page; scanned ones produced exactly 0 with `image` as the
// only node type. There is no ambiguous middle in the observed data, so the
// threshold sits low and deliberately calls a borderline file `scanned` — the
// honest failure is "we did not read this", not a grade built on 40 characters.
const MIN_CHARS_PER_PAGE = 100;

const THAI = /[฀-๿]/g;

export function triagePdf(pdf: LoadedPdf): Triage {
  let chars = 0;
  let thaiChars = 0;
  let headings = 0;

  for (const node of walk(pdf.doc)) {
    if (node.type === "heading") headings++;
    const content = node.content;
    if (typeof content === "string") {
      chars += content.length;
      thaiChars += content.match(THAI)?.length ?? 0;
    }
  }

  const pages = pdf.pages;
  if (pages === 0) {
    return { textLayer: "unreadable", pages: 0, chars, thaiChars, charsPerPage: 0, headings };
  }

  const charsPerPage = chars / pages;
  const textLayer: TextLayer = charsPerPage >= MIN_CHARS_PER_PAGE ? "digital" : "scanned";

  return { textLayer, pages, chars, thaiChars, charsPerPage, headings };
}

// Bundle members are not equal. Measured across 4 bundles: the system-generated
// `doc_*` and `annoudoc_*` files were digital 100% of the time, while the
// human-uploaded `Attach_TOR_*` scans were the ones with no text layer. When
// several documents are readable, the one carrying the terms of reference is
// what the rulebook needs to see first.
export function documentRank(name: string): number {
  const n = name.toLowerCase();
  if (n.startsWith("doc_")) return 0; // the e-bidding document — the qualifications live here
  if (n.startsWith("tor_")) return 1;
  if (/^attach_tor/.test(n)) return 2;
  if (n.startsWith("annoudoc_")) return 3; // the announcement — shorter, mostly duplicated
  if (/^attach_pub/.test(n)) return 4;
  return 5;
}

export type BundleTriage = {
  /** Readable documents, best first. Empty means nothing can be graded. */
  readable: Array<LoadedPdf & { triage: Triage }>;
  /** Everything, in bundle order, so each gets its textLayer persisted. */
  all: Array<LoadedPdf & { triage: Triage }>;
  digital: number;
  scanned: number;
};

export function triageBundle(pdfs: LoadedPdf[]): BundleTriage {
  const all = pdfs.map((pdf) => ({ ...pdf, triage: triagePdf(pdf) }));

  const readable = all
    .filter((p) => p.triage.textLayer === "digital")
    .sort((a, b) => documentRank(a.name) - documentRank(b.name) || b.triage.chars - a.triage.chars);

  return {
    all,
    readable,
    digital: readable.length,
    scanned: all.filter((p) => p.triage.textLayer === "scanned").length,
  };
}
