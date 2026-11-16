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

type CentralDirectoryLocation = {
  count: number;
  offset: number;
  size: number;
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

function centralDirectoryLocation(buf: Buffer, base: number): CentralDirectoryLocation | null {
  const eocd = findEocd(buf);
  if (eocd < 0) return null;

  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  let size = buf.readUInt32LE(eocd + 12);

  if (count === 0xffff || offset === 0xffffffff || size === 0xffffffff) {
    const locator = eocd - 20;
    if (locator >= 0 && buf.readUInt32LE(locator) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64 = Number(buf.readBigUInt64LE(locator + 8)) - base;
      if (zip64 >= 0 && zip64 + 56 <= buf.length && buf.readUInt32LE(zip64) === ZIP64_EOCD_SIGNATURE) {
        count = Number(buf.readBigUInt64LE(zip64 + 32));
        size = Number(buf.readBigUInt64LE(zip64 + 40));
        offset = Number(buf.readBigUInt64LE(zip64 + 48));
      }
    }
  }

  if (![count, offset, size].every(Number.isSafeInteger)) return null;
  return { count, offset, size };
}

function parseCentralDirectory(buf: Buffer, start: number, count: number): ZipEntry[] | null {
  const entries: ZipEntry[] = [];
  let p = start;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) break;

    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLength + extraLength + commentLength > buf.length) break;
    const name = buf.subarray(p + 46, p + 46 + nameLength).toString("utf8");

    entries.push({ name, compressedSize, uncompressedSize, method, localHeaderOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/**
 * `buf` is normally the whole archive. It may instead be only its TAIL, starting
 * at file offset `base` — how an 843 MB bulk file is listed without being read
 * (sources/govspending/bulk.ts). Offsets in the directory are absolute, so they
 * are shifted by `base`; entry offsets returned are still absolute.
 */
export function readCentralDirectory(buf: Buffer, base = 0): ZipEntry[] | null {
  const location = centralDirectoryLocation(buf, base);
  if (!location) return null;
  const start = location.offset - base;
  if (start < 0) return null;
  return parseCentralDirectory(buf, start, location.count);
}

async function readFileCentralDirectory(
  file: ReturnType<typeof Bun.file>,
  maxEntries: number,
): Promise<ZipEntry[] | "too-many-entries" | null> {
  const tailSize = Math.min(file.size, 0xffff + 22 + 76);
  const base = file.size - tailSize;
  const tail = Buffer.from(await file.slice(base, file.size).arrayBuffer());
  const location = centralDirectoryLocation(tail, base);
  if (!location) return null;
  if (location.count > maxEntries) return "too-many-entries";

  const maxDirectorySize = location.count * (46 + 0xffff * 3);
  if (
    location.size > maxDirectorySize ||
    location.offset + location.size > file.size ||
    location.offset + location.size > Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }

  const directory = Buffer.from(
    await file.slice(location.offset, location.offset + location.size).arrayBuffer(),
  );
  return parseCentralDirectory(directory, 0, location.count);
}

// The central directory records where each entry's LOCAL header is, but the
// local header carries its own (differently sized) name and extra fields, so
// the data offset can only be computed once that header is read.
async function readEntryData(
  file: ReturnType<typeof Bun.file>,
  entry: ZipEntry,
): Promise<Buffer | "too-large" | null> {
  const h = entry.localHeaderOffset;
  if (h + 30 > file.size) return null;
  const header = Buffer.from(await file.slice(h, h + 30).arrayBuffer());
  if (header.length !== 30 || header.readUInt32LE(0) !== LOCAL_SIGNATURE) return null;

  const nameLength = header.readUInt16LE(26);
  const extraLength = header.readUInt16LE(28);
  const start = h + 30 + nameLength + extraLength;
  if (start + entry.compressedSize > file.size) return null;
  const raw = Buffer.from(await file.slice(start, start + entry.compressedSize).arrayBuffer());
  if (raw.length !== entry.compressedSize) return null;

  if (entry.method === 0) return Buffer.from(raw); // stored
  if (entry.method === 8) {
    try {
      return inflateRawSync(raw, { maxOutputLength: entry.uncompressedSize });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE") {
        return "too-large";
      }
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

  const entries = await readFileCentralDirectory(file, limits.maxEntries);
  if (entries === "too-many-entries") return { ok: false, reason: "too-many-entries" };
  if (!entries || entries.length === 0) return { ok: false, reason: "not-a-zip" };

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
    const data = await readEntryData(file, entry);
    if (data === "too-large") return { ok: false, reason: "too-large" };
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
