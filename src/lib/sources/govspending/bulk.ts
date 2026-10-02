import { open, rename, rm, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { createInflateRaw } from "node:zlib";
import { politeFetch } from "../../http/politeClient.ts";
import { readCentralDirectory, type ZipEntry } from "../../extract/unzip.ts";

// The bulk file is ~850 MB of zip holding ~4.7 GB of CSV. Three rules follow:
// download it once and resume rather than restart; list it from its last few
// KB; and inflate each CSV as a stream. Nothing here ever holds the file.

export type BulkFile = {
  path: string;
  bytes: number;
  lastModified: string | null;
  /** True when the copy on disk was already current and nothing was fetched. */
  reused: boolean;
};

export type BulkHead = { bytes: number; lastModified: string | null };

// An 850 MB body at a slow government link. The timeout covers the whole body,
// and an interrupted attempt resumes from the bytes already on disk.
const DOWNLOAD_TIMEOUT_MS = 1_800_000;
const DOWNLOAD_ATTEMPTS = 5;

async function sizeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export async function headBulk(url: string): Promise<BulkHead> {
  const response = await politeFetch(url, { method: "HEAD" });
  return {
    bytes: Number(response.headers.get("content-length") ?? 0),
    lastModified: response.headers.get("last-modified"),
  };
}

/** "<bytes>|<last-modified>" — what identifies one published bulk file. */
export function bulkVersion(head: BulkHead): string {
  return `${head.bytes}|${head.lastModified ?? ""}`;
}

/**
 * The bulk zip at `dest`, downloading only what is missing.
 *
 * Each complete file carries its version in `dest.version`. It is reused only
 * when that still matches what the server publishes — size alone can't tell a
 * monthly refresh from the same file. The partial download lives at
 * `dest.part`, its version in `dest.part.version`, so a resume never stitches
 * two versions together.
 */
export async function ensureBulkFile(url: string, dest: string): Promise<BulkFile> {
  const head = await headBulk(url);
  if (!head.bytes) throw new Error("bulk file HEAD reported no content-length");
  const version = bulkVersion(head);

  const onDisk = await Bun.file(`${dest}.version`).text().catch(() => "");
  if (onDisk === version && (await sizeOf(dest)) === head.bytes) {
    return { path: dest, ...head, reused: true };
  }

  const part = `${dest}.part`;
  const versionFile = `${part}.version`;
  const partVersion = await Bun.file(versionFile).text().catch(() => "");
  if (partVersion !== version) {
    await rm(part, { force: true });
    await Bun.write(versionFile, version);
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    const have = (await sizeOf(part)) ?? 0;
    if (have === head.bytes) break;
    if (have > head.bytes) {
      await rm(part, { force: true });
      continue;
    }

    try {
      await appendRange(url, part, have);
    } catch (error) {
      lastError = error;
    }
  }

  const got = (await sizeOf(part)) ?? 0;
  if (got !== head.bytes) {
    throw new Error(`bulk download incomplete: ${got} of ${head.bytes} bytes (${String(lastError ?? "")})`);
  }

  await rename(part, dest);
  await rename(versionFile, `${dest}.version`);
  return { path: dest, ...head, reused: false };
}

async function appendRange(url: string, part: string, from: number): Promise<void> {
  const response = await politeFetch(
    url,
    from > 0 ? { headers: { Range: `bytes=${from}-` } } : {},
    { timeoutMs: DOWNLOAD_TIMEOUT_MS },
  );

  // A server that ignores Range answers 200 with the whole body; appending
  // that to a partial file would corrupt it.
  const append = from > 0 && response.status === 206;
  const file = await open(part, append ? "a" : "w");
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
}

// ── reading ────────────────────────────────────────────────────────────────

// The directory of a ten-entry zip is under 1 KB; 1 MB of tail is generous
// headroom for a trailing comment or a much larger export.
const TAIL_BYTES = 1_048_576;

/** The contract CSVs in the zip, in file order (…-1, -2, … -10). Reads only the tail. */
export async function listCsvEntries(path: string): Promise<ZipEntry[]> {
  const file = Bun.file(path);
  const base = Math.max(0, file.size - TAIL_BYTES);
  const tail = Buffer.from(await file.slice(base, file.size).arrayBuffer());

  const entries = readCentralDirectory(tail, base);
  if (!entries) throw new Error(`${path} is not a readable zip`);

  return entries
    .filter((e) => /-egp-contract-\d+\.csv$/i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** One entry's text, inflated and decoded as it streams. */
export async function* streamEntry(path: string, entry: ZipEntry): AsyncIterable<string> {
  const file = Bun.file(path);
  const header = Buffer.from(
    await file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer(),
  );
  if (header.readUInt32LE(0) !== 0x04034b50) {
    throw new Error(`${entry.name}: no local header at ${entry.localHeaderOffset}`);
  }

  const start = entry.localHeaderOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const raw = Readable.fromWeb(
    file.slice(start, start + entry.compressedSize).stream() as unknown as Parameters<typeof Readable.fromWeb>[0],
  );

  let body: AsyncIterable<Buffer>;
  if (entry.method === 8) body = raw.pipe(createInflateRaw());
  else if (entry.method === 0) body = raw;
  else throw new Error(`${entry.name}: unsupported zip method ${entry.method}`);

  // stream: true keeps a Thai character split across two chunks intact.
  const decoder = new TextDecoder("utf-8");
  for await (const chunk of body) yield decoder.decode(chunk, { stream: true });
  const rest = decoder.decode();
  if (rest) yield rest;
}
