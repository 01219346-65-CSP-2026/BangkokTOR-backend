import { inflateRawSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { env } from "../../config/env.ts";

// Expanding an untrusted archive from a government portal. Bun has no zip
// reader, so the central directory is parsed here — which is the safer shape
// anyway: the declared uncompressed size of every entry is known BEFORE a
// single byte is inflated, so a zip bomb is refused rather than survived.

export type ZipEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  method: number;
  localHeaderOffset: number;
};

export type UnzipOutcome =
  | { ok: true; dir: string; files: ExtractedFile[] }
  | { ok: false; reason: "not-a-zip" | "too-many-entries" | "too-large" | "corrupt" };

export type ExtractedFile = {
  /** Path on disk. */
  path: string;
  /** Entry name as it appeared in the archive, minus any directory prefix. */
  name: string;
  bytes: number;
};

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;

// The End Of Central Directory record sits at the very end of the file, but a
// zip may carry a trailing comment of up to 65,535 bytes, so it is found by
// scanning backwards rather than read at a fixed offset.
function findEocd(buf: Buffer): number {
  const minimum = 22;
  const start = Math.max(0, buf.length - (minimum + 0xffff));
  for (let i = buf.length - minimum; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

export function readCentralDirectory(buf: Buffer): ZipEntry[] | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);

  // A bundle past 4GB, or with more than 65,535 members, stores the real
  // numbers in a ZIP64 record and leaves 0xffff/0xffffffff as markers here.
  if (count === 0xffff || offset === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64 = Number(buf.readBigUInt64LE(locator + 8));
      if (zip64 >= 0 && zip64 + 56 <= buf.length && buf.readUInt32LE(zip64) === ZIP64_EOCD_SIGNATURE) {
        count = Number(buf.readBigUInt64LE(zip64 + 32));
        offset = Number(buf.readBigUInt64LE(zip64 + 48));
      }
    }
  }

  const entries: ZipEntry[] = [];
  let p = offset;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) break;

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString("utf8");

    entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

// The central directory records where each entry's LOCAL header is, but the
// local header carries its own (differently sized) name and extra fields, so
// the data offset can only be computed once that header is read.
function readEntryData(buf: Buffer, entry: ZipEntry): Buffer | null {
  const h = entry.localHeaderOffset;
  if (h + 30 > buf.length || buf.readUInt32LE(h) !== LOCAL_SIGNATURE) return null;

  const nameLength = buf.readUInt16LE(h + 26);
  const extraLength = buf.readUInt16LE(h + 28);
  const start = h + 30 + nameLength + extraLength;
  const raw = buf.subarray(start, start + entry.compressedSize);

  if (entry.method === 0) return Buffer.from(raw); // stored
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw);
    } catch {
      return null;
    }
  }
  return null; // an exotic method (bzip2, lzma) — treated as unreadable, not fatal
}

// A zip entry name is attacker-controlled. "../../etc/passwd" and absolute
// paths are what zip-slip is; the name is reduced to its basename so an entry
// can only ever land inside `dir`.
function safeName(name: string): string {
  return basename(name.replace(/\\/g, "/"));
}

function isPdf(name: string): boolean {
  return /\.pdf$/i.test(name) && !name.startsWith("__MACOSX");
}

export type UnzipLimits = {
  maxEntries: number;
  maxUnzippedBytes: number;
};

/**
 * Expand the PDFs of one bundle into `dir`. Non-PDF members are ignored —
 * nothing downstream reads them, and not writing them is one less thing to
 * sanitise.
 *
 * `limits` defaults to the configured caps; it is a parameter so the guards can
 * be tested without reaching into the environment.
 */
export async function unzipBundle(
  zipPath: string,
  dir: string,
  limits: UnzipLimits = { maxEntries: env.maxZipEntries, maxUnzippedBytes: env.maxUnzippedBytes },
): Promise<UnzipOutcome> {
  const file = Bun.file(zipPath);
  if (!(await file.exists())) return { ok: false, reason: "not-a-zip" };

  const buf = Buffer.from(await file.arrayBuffer());
  const entries = readCentralDirectory(buf);
  if (!entries || entries.length === 0) return { ok: false, reason: "not-a-zip" };

  if (entries.length > limits.maxEntries) return { ok: false, reason: "too-many-entries" };

  // Checked against the DECLARED sizes, before anything is inflated. That is
  // the whole point: a bomb is refused on its own manifest.
  const declared = entries.reduce((sum, e) => sum + e.uncompressedSize, 0);
  if (declared > limits.maxUnzippedBytes) return { ok: false, reason: "too-large" };

  const pdfs = entries.filter((e) => isPdf(e.name) && e.uncompressedSize > 0);
  if (pdfs.length === 0) return { ok: true, dir, files: [] };

  await mkdir(dir, { recursive: true });

  const files: ExtractedFile[] = [];
  let written = 0;

  for (const entry of pdfs) {
    const data = readEntryData(buf, entry);
    if (!data) continue; // one unreadable member must not lose the other six

    // The declared size is a claim; this is the measurement. A bomb that lies
    // in its manifest is caught here instead.
    written += data.length;
    if (written > limits.maxUnzippedBytes) return { ok: false, reason: "too-large" };

    const name = safeName(entry.name);
    const path = join(dir, name);
    await writeFile(path, data);
    files.push({ path, name, bytes: data.length });
  }

  if (files.length === 0) return { ok: false, reason: "corrupt" };
  return { ok: true, dir, files };
}
