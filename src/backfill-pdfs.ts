// OBSOLETE since 2026-09-30: extraction now deletes bundle zips once read
// (extract.service.ts discardFiles), and this script needs them. It still runs
// safely — rows whose zip is gone are skipped by the exists() check below.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { unzipBundle } from "./lib/extract/unzip.ts";
import { recordExtractedPdfs } from "./modules/extract/extract.service.ts";
import { ExtractionQueueModel } from "./modules/extract/extraction.model.ts";
import { DocumentModel } from "./modules/ingest/document.model.ts";

// One-off: give bundles extracted before per-PDF rows existed their
// `extractedPdf` rows back, and repair rows carrying a stale TOR id. Safe to
// re-run: both steps only touch what is still wrong or missing.
//
//   bun run backfill-pdfs            # report only
//   bun run backfill-pdfs --apply    # write
//
// Only re-expands the zip already on disk. It does NOT touch chunks, grades or
// TOR status — re-running extraction would, and would drop graded TORs back
// to extraction_pending. The PDFs are not re-read, so their pages and text
// layer stay null until a real extraction pass covers them.

const apply = process.argv.includes("--apply");

await connectMongo();

// Repair: PDF rows and queue rows must carry their bundle's torId. Queue rows
// went stale when TORs were re-created, and an earlier backfill copied that
// stale id onto the PDF rows, which hid them from the detail page.
const bundleTor = new Map(
  (await DocumentModel.find({ kind: "bundle" }, { torId: 1 }).lean()).map((doc) => [
    String(doc._id),
    doc.torId,
  ]),
);

const stalePdfs = (
  await DocumentModel.find({ kind: "extractedPdf" }, { torId: 1, parentDocumentId: 1 }).lean()
).filter((pdf) => {
  const tor = bundleTor.get(String(pdf.parentDocumentId));
  return tor && String(tor) !== String(pdf.torId);
});
const staleQueue = (await ExtractionQueueModel.find({}, { torId: 1, documentId: 1 }).lean()).filter(
  (row) => {
    const tor = bundleTor.get(String(row.documentId));
    return tor && String(tor) !== String(row.torId);
  },
);

console.log(`${stalePdfs.length} PDF rows and ${staleQueue.length} queue rows point at a stale TOR id.`);

if (apply) {
  for (const pdf of stalePdfs) {
    await DocumentModel.updateOne(
      { _id: pdf._id },
      { $set: { torId: bundleTor.get(String(pdf.parentDocumentId)) } },
    );
  }
  for (const row of staleQueue) {
    await ExtractionQueueModel.updateOne(
      { _id: row._id },
      { $set: { torId: bundleTor.get(String(row.documentId)) } },
    );
  }
  console.log("Repaired.");
}

const extracted = await ExtractionQueueModel.find({ status: "done" }).lean();
const alreadyDone = new Set(
  (await DocumentModel.distinct("parentDocumentId", { kind: "extractedPdf" })).map(String),
);
const todo = extracted.filter((row) => !alreadyDone.has(String(row.documentId)));

console.log(
  `${extracted.length} extracted bundles, ${extracted.length - todo.length} already have PDF rows, ${todo.length} to backfill.`,
);

let pdfs = 0;
let failed = 0;

for (const row of todo) {
  const dir = join(env.extractDir, row.projectId);

  if (!apply) {
    const exists = await Bun.file(row.localPath).exists();
    console.log(`  ${row.projectId}  ${exists ? "zip on disk" : "ZIP MISSING"}`);
    if (!exists) failed++;
    continue;
  }

  await rm(dir, { recursive: true, force: true });
  const unzipped = await unzipBundle(row.localPath, dir);
  if (!unzipped.ok) {
    console.warn(`  ${row.projectId}  skipped: ${unzipped.reason}`);
    failed++;
    continue;
  }

  await recordExtractedPdfs(row, unzipped.files);
  pdfs += unzipped.files.length;
  console.log(`  ${row.projectId}  ${unzipped.files.length} PDFs`);
}

console.log(
  apply
    ? `Done: ${pdfs} PDF rows written, ${failed} bundles skipped.`
    : `Dry run: ${failed} of ${todo.length} zips missing. Re-run with --apply to write.`,
);

await disconnectMongo();
