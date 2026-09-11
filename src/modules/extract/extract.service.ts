import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Types } from "mongoose";
import { env } from "../../config/env.ts";
import { chunkDocuments } from "../../lib/extract/chunk.ts";
import { loadBundle } from "../../lib/extract/loader.ts";
import { triageBundle } from "../../lib/extract/triage.ts";
import { unzipBundle } from "../../lib/extract/unzip.ts";
import { SOURCE_ID } from "../../lib/sources/ckan/index.ts";
import { DocumentModel } from "../ingest/document.model.ts";
import { recordError } from "../ingest/ingest.service.ts";
import { TorModel } from "../tor/tor.model.ts";
import { ChunkModel } from "./chunk.model.ts";
import { ExtractionQueueModel } from "./extraction.model.ts";

// Stage ④–⑤: bundle on disk -> PDFs -> text -> chunks a grader can read.

export type EnqueueOptions = { limit?: number };

/**
 * Sweep `documents` for fetched bundles that have no extraction row yet and
 * enqueue them. Idempotent: the unique index on documentId makes a re-run a
 * no-op rather than a duplicate.
 */
export async function enqueuePending(options: EnqueueOptions = {}) {
  const existing = await ExtractionQueueModel.distinct("documentId");

  const bundles = await DocumentModel.find({
    kind: "bundle",
    localPath: { $ne: null },
    _id: { $nin: existing },
  })
    .limit(options.limit ?? 0)
    .lean();

  let enqueued = 0;
  for (const doc of bundles) {
    const res = await ExtractionQueueModel.updateOne(
      { documentId: doc._id },
      {
        $setOnInsert: {
          sourceId: doc.sourceId,
          projectId: doc.projectId,
          torId: doc.torId,
          documentId: doc._id,
          localPath: doc.localPath,
          status: "pending",
          attempts: 0,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount > 0) enqueued++;
  }

  return { candidates: bundles.length, enqueued };
}

type ExtractRow = {
  _id: Types.ObjectId;
  projectId: string;
  torId: Types.ObjectId;
  documentId: Types.ObjectId;
  localPath: string;
};

/**
 * Process one claimed bundle. Every failure that will not improve on a retry
 * (a bomb, a corrupt archive, a bundle of pure scans) is recorded on the TOR as
 * `extraction_incomplete` and returned as ok — retrying it would burn the
 * attempt budget on a certainty.
 */
export async function processBundle(
  row: ExtractRow,
): Promise<{ ok: true; note?: string } | { ok: false; reason: string }> {
  const dir = join(env.extractDir, row.projectId);
  const jsonDir = join(dir, "_json");

  // A previous attempt may have left a half-expanded directory behind.
  await rm(dir, { recursive: true, force: true });

  const unzipped = await unzipBundle(row.localPath, dir);
  if (!unzipped.ok) {
    await markIncomplete(row, unzipped.reason);
    await recordError({
      sourceId: SOURCE_ID,
      projectId: row.projectId,
      kind: `unzip-${unzipped.reason}`,
      message: `bundle ${row.localPath} refused: ${unzipped.reason}`,
    });
    return { ok: true, note: unzipped.reason };
  }

  if (unzipped.files.length === 0) {
    await markIncomplete(row, "no-pdfs");
    return { ok: true, note: "no-pdfs" };
  }

  const loaded = await loadBundle(unzipped.files, jsonDir);
  if (!loaded.ok) {
    // The loader spawns a JVM; a failure here can be transient (memory, a
    // contended machine), so unlike the cases above this one IS worth a retry.
    await recordError({
      sourceId: SOURCE_ID,
      projectId: row.projectId,
      kind: "loader-failed",
      message: loaded.message,
    });
    return { ok: false, reason: `loader: ${loaded.message}` };
  }

  const triaged = triageBundle(loaded.pdfs);

  // The bundle is one `documents` row, so its textLayer is the bundle-level
  // verdict: readable if ANY member is. The per-member split is kept on the
  // extraction row below — that is the number that decides whether a Thai OCR
  // pass is worth buying.
  await DocumentModel.updateOne(
    { _id: row.documentId },
    { $set: { textLayer: bundleTextLayer(triaged) } },
  );

  if (triaged.readable.length === 0) {
    await markIncomplete(row, "scanned-only");
    await ExtractionQueueModel.updateOne(
      { _id: row._id },
      {
        $set: {
          pdfCount: triaged.all.length,
          digitalCount: 0,
          scannedCount: triaged.scanned,
          chunkCount: 0,
          extractedDir: dir,
        },
      },
    );
    // Not an error and not a retry: no OCR is configured, so a second pass
    // would reach the same conclusion. FR: never let a scan produce an empty grade.
    return { ok: true, note: "scanned-only" };
  }

  const chunks = chunkDocuments(triaged.readable);

  await ChunkModel.deleteMany({ documentId: row.documentId });
  if (chunks.length > 0) {
    await ChunkModel.insertMany(
      chunks.map((c) => ({
        torId: row.torId,
        projectId: row.projectId,
        documentId: row.documentId,
        filename: c.filename,
        index: c.index,
        headingPath: c.headingPath,
        text: c.text,
        chars: c.chars,
        pageStart: c.pageStart,
        pageEnd: c.pageEnd,
      })),
    );
  }

  await ExtractionQueueModel.updateOne(
    { _id: row._id },
    {
      $set: {
        pdfCount: triaged.all.length,
        digitalCount: triaged.digital,
        scannedCount: triaged.scanned,
        chunkCount: chunks.length,
        extractedDir: dir,
      },
    },
  );

  await TorModel.updateOne(
    { _id: row.torId },
    { $set: { status: "extraction_pending", statusReason: null } },
  );

  // The expanded PDFs and the loader JSON are intermediates; the chunks in
  // Mongo are the product. Keeping them would cost gigabytes per thousand
  // bundles for nothing.
  await rm(dir, { recursive: true, force: true });

  return { ok: true };
}

function bundleTextLayer(t: ReturnType<typeof triageBundle>) {
  if (t.digital > 0) return "digital";
  if (t.scanned > 0) return "scanned";
  return "unreadable";
}

async function markIncomplete(row: ExtractRow, reason: string) {
  await TorModel.updateOne(
    { _id: row.torId },
    { $set: { status: "extraction_incomplete", statusReason: reason } },
  );
}

export async function getExtractStatus() {
  const [counts, chunks, tors, recent] = await Promise.all([
    ExtractionQueueModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    ChunkModel.countDocuments(),
    TorModel.countDocuments({ status: "extraction_pending" }),
    ExtractionQueueModel.find({ status: { $in: ["done", "failed"] } })
      .sort({ updatedAt: -1 })
      .limit(10)
      .lean(),
  ]);

  const queue: Record<string, number> = { pending: 0, working: 0, done: 0, failed: 0 };
  for (const c of counts) queue[c._id] = c.n;

  const totals = await ExtractionQueueModel.aggregate<{
    _id: null;
    digital: number;
    scanned: number;
  }>([
    { $match: { status: "done" } },
    { $group: { _id: null, digital: { $sum: "$digitalCount" }, scanned: { $sum: "$scannedCount" } } },
  ]);

  const split = totals[0] ?? { digital: 0, scanned: 0 };

  return {
    queue,
    chunks,
    torsAwaitingGrade: tors,
    // The number that decides whether Thai OCR is worth buying.
    pdfSplit: {
      digital: split.digital,
      scanned: split.scanned,
      scannedPct:
        split.digital + split.scanned > 0
          ? Math.round((100 * split.scanned) / (split.digital + split.scanned))
          : null,
    },
    recent: recent.map((r) => ({
      projectId: r.projectId,
      status: r.status,
      pdfCount: r.pdfCount,
      digitalCount: r.digitalCount,
      scannedCount: r.scannedCount,
      chunkCount: r.chunkCount,
      reason: r.reason,
    })),
  };
}
