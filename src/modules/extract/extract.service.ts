import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Types } from "mongoose";
import { env } from "../../config/env.ts";
import { loadBundle } from "../../lib/extract/loader.ts";
import { triageBundle } from "../../lib/extract/triage.ts";
import { unzipBundle } from "../../lib/extract/unzip.ts";
import { SOURCE_ID } from "../../lib/sources/ckan/index.ts";
import { DocumentModel } from "../ingest/document.model.ts";
import { recordError } from "../ingest/ingest.service.ts";
import { TorModel } from "../tor/tor.model.ts";
import { tagTorSkills } from "../tor/tor.skills.ts";
import { ExtractionQueueModel } from "./extraction.model.ts";
import { buildFullText } from "../../lib/extract/fulltext.ts";
import { TorTextModel } from "./torText.model.ts";

// Stage ④–⑤: bundle on disk -> PDFs -> full text a grader can read.

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

type BundleOutcome = { ok: true; note?: string } | { ok: false; reason: string };

/**
 * Process one claimed bundle. Every failure that will not improve on a retry
 * (a bomb, a corrupt archive, a bundle of pure scans) is recorded on the TOR as
 * `extraction_incomplete` and returned as ok — retrying it would burn the
 * attempt budget on a certainty.
 *
 * Once the outcome is final, the zip and the PDFs expanded from it are deleted
 * (see discardFiles). A retryable failure keeps them: the next attempt needs
 * the zip, and re-downloading it would cost more than the disk.
 */
export async function processBundle(queued: ExtractRow): Promise<BundleOutcome> {
  const outcome = await extractBundle(queued);
  if (outcome.ok) await discardFiles(queued);
  return outcome;
}

/**
 * Nothing downstream reads the files once extraction is done: grading, skill
 * tags and summaries all read tor_texts. Keeping them cost ~67 MB a project
 * (59 GB for 887). The documents rows stay — filename, pages, text layer — and
 * their url is the e-GP bundle link, which the site offers instead.
 */
async function discardFiles(row: Pick<ExtractRow, "projectId" | "documentId" | "localPath">) {
  if (env.keepDocumentFiles) return;

  await rm(row.localPath, { force: true });
  // A projectId is an e-GP number; anything else must not become a path.
  if (/^\d+$/.test(row.projectId)) {
    await rm(join(env.extractDir, row.projectId), { recursive: true, force: true });
  }

  await DocumentModel.updateMany(
    { $or: [{ _id: row.documentId }, { parentDocumentId: row.documentId }] },
    { $set: { localPath: null } },
  );
}

async function extractBundle(queued: ExtractRow): Promise<BundleOutcome> {
  // A queue row's torId goes stale when its TOR is re-created; the bundle
  // document is kept in step, so the id is read from there.
  const bundle = await DocumentModel.findById(queued.documentId, { torId: 1 }).lean();
  const row = { ...queued, torId: bundle?.torId ?? queued.torId };

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

  // Every member is kept and listed — scans included. A reader can open a
  // scanned PDF even though the grader cannot read it.
  await recordExtractedPdfs(
    row,
    triaged.all.map((pdf) => ({ ...pdf, textLayer: pdf.triage.textLayer })),
  );

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
          textChars: 0,
          extractedDir: dir,
        },
      },
    );
    // Not an error and not a retry: no OCR is configured, so a second pass
    // would reach the same conclusion. FR: never let a scan produce an empty grade.
    return { ok: true, note: "scanned-only" };
  }

  const tor_text = buildFullText(triaged.readable);

  if (tor_text.chars === 0) {
    return { ok: true, note: "no-text"};
  }
  await TorTextModel.updateOne(
    { torId: row.torId},
    { $set: {
        torId: row.torId,
        projectId: row.projectId,
        documentId: row.documentId,
        fullText: tor_text.text,
        chars: tor_text.chars,
        truncated: tor_text.truncated,
        files: tor_text.files
    }},
    { upsert: true }
  )


  await ExtractionQueueModel.updateOne(
    { _id: row._id },
    {
      $set: {
        pdfCount: triaged.all.length,
        digitalCount: triaged.digital,
        scannedCount: triaged.scanned,
        textChars: tor_text.chars,
        extractedDir: dir,
      },
    },
  );

  await TorModel.updateOne(
    { _id: row.torId },
    { $set: { status: "extraction_pending", statusReason: null } },
  );

  // Tag the TOR now that it has reached the grading queue.
  await tagTorSkills(row.torId);

  // The loader JSON is an intermediate. The expanded PDFs go too, in
  // discardFiles, unless KEEP_DOCUMENT_FILES — then each `extractedPdf` row is
  // served from GET /api/tors/:id/documents/:documentId/file.
  await rm(jsonDir, { recursive: true, force: true });

  return { ok: true };
}

export type ExtractedPdfInput = {
  name: string;
  path: string;
  bytes: number;
  /** Null when the PDF was expanded but never read (the backfill). */
  pages?: number | null;
  textLayer?: "digital" | "scanned" | "unreadable" | null;
};

/**
 * One `documents` row per expanded PDF. Keyed on the bundle id plus the entry
 * name, so a retry updates the same rows instead of adding more.
 */
export async function recordExtractedPdfs(
  row: Pick<ExtractRow, "projectId" | "documentId">,
  pdfs: ExtractedPdfInput[],
) {
  // torId comes from the bundle, not the caller: queue rows can carry a stale one.
  const bundle = await DocumentModel.findById(row.documentId, { url: 1, torId: 1 }).lean();
  if (!bundle) return;

  for (const pdf of pdfs) {
    const externalId = `${String(row.documentId)}#${pdf.name}`;
    await DocumentModel.updateOne(
      { sourceId: SOURCE_ID, projectId: row.projectId, externalId },
      {
        $set: {
          localPath: pdf.path,
          bytes: pdf.bytes,
          pages: pdf.pages ?? null,
          textLayer: pdf.textLayer ?? null,
          fetchedAt: new Date(),
          torId: bundle.torId,
        },
        $setOnInsert: {
          kind: "extractedPdf",
          // The portal has no per-PDF link; the bundle it came out of is the
          // closest source fact.
          url: bundle.url,
          filename: pdf.name,
          parentDocumentId: row.documentId,
        },
      },
      { upsert: true },
    );
  }

  // A re-extraction that yields fewer members must not leave rows pointing at
  // files that no longer exist.
  await DocumentModel.deleteMany({
    kind: "extractedPdf",
    parentDocumentId: row.documentId,
    filename: { $nin: pdfs.map((pdf) => pdf.name) },
  });
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
  const [counts, tor_texts, tors, recent] = await Promise.all([
    ExtractionQueueModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    TorTextModel.countDocuments(),
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
    tor_texts,
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
      textChars: r.textChars,
      reason: r.reason,
    })),
  };
}
