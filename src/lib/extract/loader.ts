import { convert } from "@opendataloader/pdf";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ExtractedFile } from "./unzip.ts";

// Wraps @opendataloader/pdf. Every invocation spawns a JVM, so all the PDFs of
// one bundle go in a SINGLE call — measured at ~0.7s for 7 files / 18MB, versus
// a JVM start per file.

/**
 * One node of opendataloader's JSON tree. Verified against real e-GP output:
 * the document root carries metadata plus `kids`, and every content node has a
 * `type`, a `page number`, and (for text) a `content` string.
 */
export type LoaderNode = {
  type?: string;
  content?: string;
  kids?: LoaderNode[];
  "page number"?: number;
  "heading level"?: number;
  "font size"?: number;
  id?: number;
  "list items"?: LoaderNode[];
  rows?: { cells?: LoaderNode[] }[];
};

export type LoaderDocument = {
  "file name"?: string;
  "number of pages"?: number;
  title?: string;
  author?: string;
  kids?: LoaderNode[];
};

export type LoadedPdf = {
  /** Entry name inside the bundle, e.g. "Attach_TOR_1.pdf". */
  name: string;
  path: string;
  bytes: number;
  pages: number;
  doc: LoaderDocument;
};

export type LoadOutcome =
  | { ok: true; pdfs: LoadedPdf[] }
  | { ok: false; reason: "loader-failed"; message: string };


function normalize(content: unknown): string {
  if (typeof content !== "string") return "";
  return content.replace(/\s+/g, " ").trim();
}

export function getNodeContent(node: LoaderNode): string {
  if (node.type === "image") return "";

  const node_texts: string[] = [];
  const content = normalize(node.content);
  if (content) node_texts.push(content);

  for (const row of node.rows ?? []) {
    const cells = (row.cells ?? [])
      .map(getNodeContent)
      .filter((cell) => cell.length > 0);
    if (cells.length > 0) node_texts.push(cells.join(" | "));
  }

  for (const item of node["list items"] ?? []) {
    const item_text = getNodeContent(item);
    if (item_text) node_texts.push(item_text);
  }

  for (const kid of node.kids ?? []) {
    const kid_text = getNodeContent(kid);
    if (kid_text) node_texts.push(kid_text);
  }

  return node_texts.join("\n");
}



/**
 * Convert every PDF of one bundle to opendataloader JSON, then read the JSON
 * back in. `outputDir` receives one `<name>.json` per input.
 */
export async function loadBundle(
  files: ExtractedFile[],
  outputDir: string,
  timeoutMs = 600_000,
): Promise<LoadOutcome> {
  if (files.length === 0) return { ok: true, pdfs: [] };

  try {
    await withTimeout(
      convert(
        files.map((f) => f.path),
        {
          outputDir,
          format: "json",
          quiet: true,
          // We grade text, never pictures. Off keeps a 70-page scan from
          // writing hundreds of PNGs we would only delete.
          imageOutput: "off",
        },
      ),
      timeoutMs,
    );
  } catch (error) {
    return { ok: false, reason: "loader-failed", message: String(error) };
  }

  const pdfs: LoadedPdf[] = [];

  for (const file of files) {
    const jsonPath = join(outputDir, `${basename(file.name).replace(/\.pdf$/i, "")}.json`);
    let doc: LoaderDocument;
    try {
      doc = JSON.parse(await readFile(jsonPath, "utf8")) as LoaderDocument;
    } catch {
      // The loader skipped this one (encrypted, malformed). Its siblings are
      // still worth grading, so this is an omission, not a failure.
      continue;
    }
    pdfs.push({
      name: file.name,
      path: file.path,
      bytes: file.bytes,
      pages: doc["number of pages"] ?? 0,
      doc,
    });
  }

  return { ok: true, pdfs };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`loader timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Depth-first walk of the node tree in reading order. */
export function* walk(node: LoaderNode | LoaderDocument): Generator<LoaderNode> {
  for (const kid of node.kids ?? []) {
    yield kid;
    yield* walk(kid);
  }
}
