import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import { decodeXml, parseSheet, readXlsx, unzip } from "./readXlsx.ts";

// A minimal zip writer, so the tests build real .xlsx bytes without a binary
// fixture checked in. Local header + data per entry, then the central
// directory, then the end record — the same three parts unzip() walks.
function zip(entries: Record<string, string>, compress = true): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = enc.encode(name);
    const raw = enc.encode(content);
    const data = compress ? new Uint8Array(deflateRawSync(raw)) : raw;
    const crc = Bun.hash.crc32(raw);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, compress ? 8 : 0, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, compress ? 8 : 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const SHEET = (rows: string) =>
  `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

const WORKBOOK = `<workbook xmlns:r="r"><sheets>
  <sheet name="คำนำ" sheetId="1" r:id="rId1"/>
  <sheet name="รายละเอียด" sheetId="2" r:id="rId2"/>
</sheets></workbook>`;
const RELS = `<Relationships>
  <Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/>
</Relationships>`;
const SHARED = `<sst><si><t>สำนักดิจิทัลกรุงเทพมหานคร</t></si><si><r><t>ค่าใช้จ่าย</t></r><r><t xml:space="preserve"> ระบบ</t></r></si></sst>`;

describe("unzip", () => {
  test("stored and deflated entries", () => {
    for (const compress of [false, true]) {
      const files = unzip(zip({ "a.txt": "hello", "dir/b.txt": "สวัสดี" }, compress));
      expect(new TextDecoder().decode(files.get("a.txt"))).toBe("hello");
      expect(new TextDecoder().decode(files.get("dir/b.txt"))).toBe("สวัสดี");
    }
  });

  test("not a zip → a clear error", () => {
    expect(() => unzip(new TextEncoder().encode("PK? no, a CSV"))).toThrow(/not a zip/);
  });
});

describe("parseSheet", () => {
  test("shared, inline and plain values; empty cells and rows dropped", () => {
    const rows = parseSheet(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="2"/></row>
       <row r="2"/>
       <row r="3"><c r="C3" t="inlineStr"><is><t>07199-8</t></is></c><c r="G3"><v>36275860</v></c></row>`,
      ["สำนักดิจิทัล"],
    );
    expect(rows).toEqual([{ A: "สำนักดิจิทัล" }, { C: "07199-8", G: "36275860" }]);
  });

  test("a sheet of self-closing rows stays linear (70010.xlsx carries a million)", () => {
    const empty = '<row r="9" s="3" customFormat="1"/>'.repeat(200_000);
    const started = performance.now();
    const rows = parseSheet(`${empty}<row r="1"><c r="A1"><v>1</v></c></row>${empty}`, []);
    expect(rows).toEqual([{ A: "1" }]);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("readXlsx", () => {
  test("sheets in workbook order, by name, with rich text joined", () => {
    const bytes = zip({
      "xl/workbook.xml": WORKBOOK,
      "xl/_rels/workbook.xml.rels": RELS,
      "xl/sharedStrings.xml": SHARED,
      "xl/worksheets/sheet1.xml": SHEET(`<row r="1"><c r="A1" t="s"><v>0</v></c></row>`),
      "xl/worksheets/sheet2.xml": SHEET(`<row r="1"><c r="D1" t="s"><v>1</v></c><c r="G1"><v>500</v></c></row>`),
    });
    const sheets = readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["คำนำ", "รายละเอียด"]);
    expect(sheets[1]!.rows).toEqual([{ D: "ค่าใช้จ่าย ระบบ", G: "500" }]);
  });

  test("no workbook.xml → worksheets in numeric order", () => {
    const sheets = readXlsx(
      zip({
        "xl/worksheets/sheet10.xml": SHEET(`<row r="1"><c r="A1"><v>10</v></c></row>`),
        "xl/worksheets/sheet2.xml": SHEET(`<row r="1"><c r="A1"><v>2</v></c></row>`),
      }),
    );
    expect(sheets.map((s) => s.name)).toEqual(["sheet2", "sheet10"]);
  });
});

test("decodeXml", () => {
  expect(decodeXml("A &amp; B &lt;x&gt; &#3585; &#x0E01;")).toBe("A & B <x> ก ก");
});
