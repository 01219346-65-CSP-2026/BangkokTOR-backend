import { inflateRawSync } from "node:zlib";

// Just enough of .xlsx to read the cell text out of a government spreadsheet,
// so the budget importer adds no dependency (AGENTS.md: three packages).
//
// An .xlsx is a zip of XML parts. We need three things from it: the zip's
// central directory (where each part is), the shared-strings table (most cell
// text lives there, referenced by index), and each worksheet's <row>/<c>
// cells. Formulas, styles, merged cells and dates are ignored — every value
// comes back as the text Excel stored, which for the BMA files is labels and
// whole-baht integers.
//
// Old binary .xls (BIFF) is a different format entirely; convert it first
// (scripts/import-budget.ts runs LibreOffice for that when it is installed).

/** One worksheet: its rows in order, each a column letter → cell text map.
 *  Rows with no text at all are dropped. */
export type Sheet = { name: string; rows: Array<Record<string, string>> };

// ─── zip ────────────────────────────────────────────────────────────────────

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Every file in the zip, by path. Stored (0) and deflated (8) entries only —
 *  the two methods Excel writes. */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record sits in the last 22 bytes plus an
  // optional comment of up to 64KB, so scan backwards for its signature.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory record)");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const files = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();

  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== CENTRAL) throw new Error("corrupt zip central directory");
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + extraLength + commentLength;

    // Sizes are taken from the central directory: the local header's copies
    // can be zero when the writer streamed the entry.
    if (view.getUint32(localOffset, true) !== LOCAL) throw new Error(`corrupt zip entry ${name}`);
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = bytes.subarray(start, start + compressedSize);

    if (method === 0) files.set(name, data);
    else if (method === 8) files.set(name, new Uint8Array(inflateRawSync(data)));
    else throw new Error(`zip entry ${name} uses unsupported compression method ${method}`);
  }
  return files;
}

// ─── xml ────────────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[ref] ?? whole;
  });
}

/** The text of every <t> inside `xml`, joined — a rich-text cell is several
 *  runs. Phonetic guides (<rPh>) are not part of the value. */
function textRuns(xml: string): string {
  const withoutPhonetic = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of withoutPhonetic.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]!));
}

/** Rows of one worksheet part. */
export function parseSheet(xml: string, shared: string[]): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  // A row, like a cell, is either <row …/> (empty) or <row …>…</row>. The
  // self-closing form must be matched as such: 70010.xlsx (สำนักปลัด, 2570)
  // carries a 47MB sheet of a million styled empty rows, and reading each
  // <row …/> as an opening tag scans ahead to the next </row> — quadratic.
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (!row[1]) continue;
    const cells: Record<string, string> = {};
    // A cell is either <c …/> (empty) or <c …>…</c>.
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const body = cell[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let value: string;
      if (type === "inlineStr") {
        value = textRuns(body);
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        if (v === undefined) continue;
        value = type === "s" ? (shared[Number(v)] ?? "") : decodeXml(v);
      }
      value = value.trim();
      if (value) cells[ref] = value;
    }
    if (Object.keys(cells).length) rows.push(cells);
  }
  return rows;
}

/** Every worksheet in workbook order. */
export function readXlsx(bytes: Uint8Array): Sheet[] {
  const files = unzip(bytes);
  const text = (path: string) => {
    const data = files.get(path);
    return data ? new TextDecoder().decode(data) : undefined;
  };
  const shared = sharedStrings(text("xl/sharedStrings.xml"));

  // Workbook order and names come from workbook.xml + its rels; fall back to
  // the sheetN.xml files in numeric order if either is missing.
  const workbook = text("xl/workbook.xml") ?? "";
  const rels = text("xl/_rels/workbook.xml.rels") ?? "";
  const targets = new Map(
    [...rels.matchAll(/<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"/g)].map((m) => [m[1]!, m[2]!]),
  );
  const declared = [...workbook.matchAll(/<sheet\b[^>]*?name="([^"]*)"[^>]*?r:id="([^"]+)"/g)]
    .map((m) => {
      const target = targets.get(m[2]!);
      if (!target) return null;
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
      return { name: decodeXml(m[1]!), path };
    })
    .filter((s): s is { name: string; path: string } => s !== null && files.has(s.path));

  const sheets = declared.length
    ? declared
    : [...files.keys()]
        .filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p))
        .sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]))
        .map((path) => ({ name: path.slice("xl/worksheets/".length, -4), path }));

  return sheets.map(({ name, path }) => ({ name, rows: parseSheet(text(path)!, shared) }));
}
