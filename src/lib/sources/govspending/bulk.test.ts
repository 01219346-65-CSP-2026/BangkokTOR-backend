import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listCsvEntries, streamEntry } from "./bulk.ts";
import { discoverBulk, type BulkCursor } from "./index.ts";

// A real zip from the system `zip`, shaped like the govspending export: numbered
// contract CSVs (deflated, Thai text, a quoted newline) plus a submit zip that
// must be ignored.
async function makeBulk(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bulk-test-"));
  const src = join(dir, "src");
  await Bun.$`mkdir -p ${src}`.quiet();

  const header = "ลำดับ,รหัสโครงการ,ชื่อโครงการจัดซื้อจัดจ้าง,ปีงบประมาณ\n";
  const rows = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => `${from + i},${690000 + from + i},"โครงการ ${from + i}, ระบบ\nบรรทัดสอง",2569`).join("\n");

  await writeFile(join(src, "2569-egp-contract-10.csv"), header + rows(21, 2) + "\n");
  await writeFile(join(src, "2569-egp-contract-2.csv"), header + rows(11, 10) + "\n");
  await writeFile(join(src, "2569-egp-contract-1.csv"), "﻿" + header + rows(1, 10) + "\n");
  await writeFile(join(src, "2569-egp-contract-submit.zip"), "not read");

  const zip = join(dir, "2569-egp-contract.zip");
  await Bun.$`cd ${src} && zip -q ${zip} 2569-egp-contract-1.csv 2569-egp-contract-10.csv 2569-egp-contract-2.csv 2569-egp-contract-submit.zip`.quiet();
  return zip;
}

async function collect(zip: string, cursor: BulkCursor = {}) {
  const ids: string[] = [];
  for await (const raw of discoverBulk(zip, 2569, cursor)) ids.push(raw.projectId);
  return ids;
}

describe("listCsvEntries", () => {
  test("lists only the contract CSVs, in natural order, from the tail", async () => {
    const zip = await makeBulk();
    expect((await listCsvEntries(zip)).map((e) => e.name)).toEqual([
      "2569-egp-contract-1.csv",
      "2569-egp-contract-2.csv",
      "2569-egp-contract-10.csv",
    ]);
  });
});

describe("streamEntry", () => {
  test("inflates an entry back to its exact text", async () => {
    const zip = await makeBulk();
    const [first] = await listCsvEntries(zip);
    let text = "";
    for await (const chunk of streamEntry(zip, first!)) text += chunk;
    // TextDecoder drops the BOM itself; parseCsv would too.
    expect(text.startsWith("ลำดับ,รหัสโครงการ")).toBe(true);
    expect(text).toContain('"โครงการ 1, ระบบ\nบรรทัดสอง"');
  });
});

describe("discoverBulk", () => {
  test("every row of every entry, keyed to CKAN names", async () => {
    const zip = await makeBulk();
    const ids = await collect(zip);
    expect(ids.length).toBe(22);
    expect(ids[0]).toBe("690001");
    expect(ids.at(-1)).toBe("690022");

    for await (const raw of discoverBulk(zip, 2569)) {
      expect(raw.fields["ชื่อโครงการ"]).toBe("โครงการ 1, ระบบ\nบรรทัดสอง");
      expect(raw.header).toEqual([]);
      break;
    }
  });

  test("resumes inside the entry the cursor names", async () => {
    const zip = await makeBulk();
    const ids = await collect(zip, { fiscalYear: 2569, entry: "2569-egp-contract-2.csv", row: 7 });
    expect(ids).toEqual(["690018", "690019", "690020", "690021", "690022"]);
  });

  test("a cursor from another year starts over", async () => {
    const zip = await makeBulk();
    expect((await collect(zip, { fiscalYear: 2568, entry: "2569-egp-contract-2.csv", row: 7 })).length).toBe(22);
  });

  test("reports progress at each entry's end", async () => {
    const zip = await makeBulk();
    const seen: string[] = [];
    for await (const _ of discoverBulk(zip, 2569, {}, (p) => void seen.push(`${p.entry}:${p.row}`))) void _;
    expect(seen).toEqual(["2569-egp-contract-1.csv:10", "2569-egp-contract-2.csv:10", "2569-egp-contract-10.csv:2"]);
  });
});
