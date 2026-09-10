import { createHash } from "node:crypto";
import { politeFetch } from "../../http/politeClient.ts";
import { env } from "../../../config/env.ts";
import type { FetchOutcome } from "../outcome.ts";
import type { RawDocument } from "../types.ts";
import { SOURCE_ID } from "./normalize.ts";

const EGP_ORIGIN = "https://process5.gprocurement.go.th";
const METADATA_URL = `${EGP_ORIGIN}/egp-approval-service/apv-common/infoProcureDocAnnounZipTemp`;
const DOWNLOAD_URL = `${EGP_ORIGIN}/egp-upload-service/v1/downloadFileTest`;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

type MetadataResponse = {
  response?: { responseCode?: string; messageCode?: string; description?: string };
  data?: { zipId?: string | null; buildName1?: string | null } | null;
  fieldErrors?: Array<{ field?: string; errorCode?: string; errorMessage?: string }>;
};

export class EgpFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EgpFieldError";
  }
}

// Hop 1: does this project have a bundle?
//   responseCode "0"                -> data.zipId is a 32-hex download handle
//   responseCode "1" + E0001        -> no bundle. The expected MAJORITY outcome,
//                                      returned as data so it never reaches
//                                      ingest_errors and drowns the admin panel.
//   fieldErrors[]                   -> we sent a malformed request; that IS a bug
export async function listDocuments(projectId: string): Promise<RawDocument[]> {
  const url = `${METADATA_URL}?projectId=${encodeURIComponent(projectId)}`;
  const response = await politeFetch(url, {}, { timeoutMs: 30_000 });
  const payload = (await response.json()) as MetadataResponse;

  if (payload.fieldErrors?.length) {
    const detail = payload.fieldErrors
      .map((f) => `${f.field ?? "?"}:${f.errorCode ?? "?"}`)
      .join(", ");
    throw new EgpFieldError(`e-GP rejected the request for ${projectId} (${detail})`);
  }

  if (payload.response?.responseCode === "0" && payload.data?.zipId) {
    return [
      {
        projectId,
        kind: "bundle",
        url: `${DOWNLOAD_URL}?fileId=${encodeURIComponent(payload.data.zipId)}`,
        externalId: payload.data.zipId,
        filename: payload.data.buildName1 ?? `${payload.data.zipId}.zip`,
      },
    ];
  }

  return [];
}

// Hop 2: stream the bundle to disk.
//
// The response carries NO content-length (verified), so the cap is enforced by
// counting bytes as they arrive. Writes stream to a .part file and rename on
// success — never leave a truncated file that looks complete to the next run.
export async function fetchDocument(doc: RawDocument, dest: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const maxBytes = env.maxBundleBytes;
  const partPath = `${dest}.part`;

  const response = await politeFetch(
    doc.url,
    { signal: controller.signal },
    { timeoutMs: 300_000 },
  );

  if (!response.body) return { ok: false, reason: "no-file-attached" };

  const hash = createHash("sha256");
  const writer = Bun.file(partPath).writer();
  const magic: number[] = [];
  let bytes = 0;

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      // A 200 carrying an HTML error page or a WAF challenge is a real observed
      // failure mode. Catching it on the first four bytes is cheaper than at
      // unzip time.
      if (magic.length < 4) {
        for (const byte of chunk.slice(0, 4 - magic.length)) magic.push(byte);
        if (magic.length === 4 && !ZIP_MAGIC.every((b, i) => magic[i] === b)) {
          controller.abort();
          await writer.end();
          await safeUnlink(partPath);
          return { ok: false, reason: "not-a-zip" };
        }
      }

      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        controller.abort();
        await writer.end();
        await safeUnlink(partPath);
        return { ok: false, reason: "oversize", bytes };
      }

      hash.update(chunk);
      // Awaited: on a 500MB stream unawaited writes outpace the disk and the
      // backlog grows in memory — the thing streaming exists to avoid.
      await writer.write(chunk);
    }

    await writer.end();

    if (bytes === 0) {
      await safeUnlink(partPath);
      return { ok: false, reason: "no-file-attached" };
    }

    // Only now does the file get its real name.
    await Bun.write(dest, Bun.file(partPath));
    await safeUnlink(partPath);

    return { ok: true, bytes, sha256: hash.digest("hex"), path: dest };
  } catch (error) {
    try {
      await writer.end();
    } catch {
      // The stream is already broken; the original error is the useful one.
    }
    await safeUnlink(partPath);
    throw error;
  }
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await Bun.file(path).delete();
  } catch {
    // Already gone, or never created.
  }
}

export { SOURCE_ID };