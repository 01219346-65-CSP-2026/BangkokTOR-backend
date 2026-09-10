import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCentralDirectory, unzipBundle } from "./unzip.ts";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "unzip-test-"));
}

// Builds a real zip with the system `zip`, so the parser is tested against
// bytes some other implementation produced rather than its own output.
async function makeZip(files: Record<string, string>): Promise<{ zip: string; dir: string }> {
  const dir = await tmp();
  const src = join(dir, "src");
  await Bun.$`mkdir -p ${src}`.quiet();
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(src, name), content);
  }
  const zip = join(dir, "bundle.zip");
  await Bun.$`cd ${src} && zip -q -r ${zip} .`.quiet();
  return { zip, dir };
}

describe("readCentralDirectory", () => {
  test("lists every member of a real zip", async () => {
    const { zip } = await makeZip({ "a.pdf": "x".repeat(200), "b.txt": "y" });
    const buf = Buffer.from(await Bun.file(zip).arrayBuffer());
    const names = readCentralDirectory(buf)!.map((e) => e.name);

    expect(names).toContain("a.pdf");
    expect(names).toContain("b.txt");
  });

  test("returns null on something that is not a zip", () => {
    expect(readCentralDirectory(Buffer.from("not a zip at all"))).toBeNull();
  });
});

describe("unzipBundle", () => {
  test("extracts the PDFs and ignores everything else", async () => {
    const { zip } = await makeZip({
      "doc_1.pdf": "%PDF-1.4 " + "x".repeat(500),
      "notes.txt": "ignored",
    });
    const out = await tmp();
    const result = await unzipBundle(zip, out);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((f) => f.name)).toEqual(["doc_1.pdf"]);
    expect(await readdir(out)).toEqual(["doc_1.pdf"]);
  });

  test("round-trips content through deflate", async () => {
    const body = "%PDF-1.4 ก".repeat(400);
    const { zip } = await makeZip({ "a.pdf": body });
    const out = await tmp();
    const result = await unzipBundle(zip, out);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await Bun.file(result.files[0]!.path).text()).toBe(body);
  });

  test("a zip-slip name cannot escape the output directory", async () => {
    // Entry names are attacker-controlled. Rather than patching a zip (which
    // shifts offsets), this builds one whose stored name really is "../evil.pdf".
    const body = Buffer.from("%PDF-1.4 zip slip");
    const name = Buffer.from("../evil.pdf");
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(0, 8); // stored, no compression
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42); // local header sits at offset 0

    const centralOffset = local.length + name.length + body.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(centralOffset, 16);

    const hostileBytes = Buffer.concat([local, name, body, central, name, eocd]);
    const hostile = join(await tmp(), "hostile.zip");
    await writeFile(hostile, hostileBytes);

    // The archive really does declare a traversing name.
    expect(readCentralDirectory(hostileBytes)!.map((e) => e.name)).toEqual(["../evil.pdf"]);

    const out = await tmp();
    const result = await unzipBundle(hostile, out);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Reduced to a basename: it landed inside `out`, and nowhere above it.
    expect(result.files[0]!.name).toBe("evil.pdf");
    expect(result.files[0]!.path).toBe(join(out, "evil.pdf"));
    expect(await readdir(out)).toEqual(["evil.pdf"]);
  });

  test("refuses a bomb on its DECLARED size, before inflating anything", async () => {
    // The guard that matters: the archive is rejected from its own manifest, so
    // the compressed bytes are never expanded into memory.
    const { zip } = await makeZip({ "a.pdf": "%PDF " + "x".repeat(50_000) });
    const out = await tmp();

    const result = await unzipBundle(zip, out, { maxEntries: 200, maxUnzippedBytes: 1_000 });

    expect(result).toEqual({ ok: false, reason: "too-large" });
    // Nothing was written: the refusal happened before any inflate.
    expect(await readdir(out).catch(() => [])).toEqual([]);
  });

  test("refuses an archive with too many members", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 12; i++) files[`f${i}.pdf`] = "%PDF x";
    const { zip } = await makeZip(files);

    const result = await unzipBundle(zip, await tmp(), {
      maxEntries: 5,
      maxUnzippedBytes: 1_000_000,
    });

    expect(result).toEqual({ ok: false, reason: "too-many-entries" });
  });

  test("a missing file is reported, not thrown", async () => {
    const result = await unzipBundle(join(await tmp(), "nope.zip"), await tmp());
    expect(result).toEqual({ ok: false, reason: "not-a-zip" });
  });

  test("a zip with no PDFs succeeds with nothing to grade", async () => {
    const { zip } = await makeZip({ "readme.txt": "hello" });
    const result = await unzipBundle(zip, await tmp());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(0);
  });
});
