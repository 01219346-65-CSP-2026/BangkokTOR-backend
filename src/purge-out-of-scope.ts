import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { Types } from "mongoose";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { resolveDataset } from "./lib/sources/ckan/catalog.ts";
import { resolveBulk } from "./lib/sources/govspending/catalog.ts";
import { SOURCE_ID } from "./lib/sources/ckan/normalize.ts";
import { ChunkModel } from "./modules/extract/chunk.model.ts";
import { ExtractionQueueModel } from "./modules/extract/extraction.model.ts";
import { DocumentModel } from "./modules/ingest/document.model.ts";
import { ErrorModel } from "./modules/ingest/error.model.ts";
import { QueueModel, type QueueStatus } from "./modules/ingest/queue.model.ts";
import { WatermarkModel } from "./modules/ingest/watermark.model.ts";
import { TorModel } from "./modules/tor/tor.model.ts";

// Delete every TOR the website no longer covers — anything that is not
// software work from the current fiscal year — with everything hanging off it:
// documents, chunks, extraction rows, errors, queue rows, and the files on disk.
//
//   bun run purge-out-of-scope                       # report only
//   bun run purge-out-of-scope --apply               # delete
//   bun run purge-out-of-scope --fiscal-year 2568    # target a year without asking data.go.th
//
// Irreversible. The rows can be re-ingested, but the downloads, extractions and
// grades behind them cost hours to redo. Read the dry run first.
//
// Also resets the CKAN watermark (the cursor shape changed to per-resource) and
// drops pending/failed queue rows: they were enqueued before discovery filtered
// on software, and the next discovery run re-enqueues the ones that qualify.

const apply = process.argv.includes("--apply");
const yearArg = process.argv[process.argv.indexOf("--fiscal-year") + 1];
const pinned = process.argv.includes("--fiscal-year") ? Number(yearArg) : undefined;
if (pinned !== undefined && !Number.isInteger(pinned)) {
  console.error("--fiscal-year needs a Buddhist-era year, e.g. 2568");
  process.exit(1);
}

const BATCH = 1_000;

// The same feed discovery uses — asking CKAN while discovery reads govspending
// would target last year and delete this year's rows.
const fiscalYear =
  pinned ?? (env.egpFeed === "ckan" ? (await resolveDataset()).fiscalYear : (await resolveBulk()).fiscalYear);
console.log(`Target: software TORs from fiscal year ${fiscalYear}.`);

await connectMongo();

const outOfScope = { $nor: [{ isSoftware: true, fiscalYear }] };

const [total, reasons] = await Promise.all([
  TorModel.countDocuments(),
  TorModel.aggregate<{ _id: { software: boolean | null; year: number | null }; n: number }>([
    { $match: outOfScope },
    { $group: { _id: { software: "$isSoftware", year: "$fiscalYear" }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]),
]);

const victims = await TorModel.find(outOfScope, { _id: 1, projectId: 1 }).lean();
const kept = total - victims.length;

console.log(`\ntors: ${total} total → keep ${kept}, delete ${victims.length}`);
for (const r of reasons) {
  const what = r._id.software ? "software" : r._id.software === false ? "not software" : "unclassified";
  console.log(`  ${String(r.n).padStart(7)}  ${what}, FY ${r._id.year ?? "unknown"}`);
}

const torIds = victims.map((v) => v._id as Types.ObjectId);
const projectIds = victims.map((v) => v.projectId);

// Counted in batches: a $in over tens of thousands of ids is one huge query.
async function countIn(count: (ids: Types.ObjectId[], pids: string[]) => Promise<number>) {
  let n = 0;
  for (let i = 0; i < torIds.length; i += BATCH) {
    n += await count(torIds.slice(i, i + BATCH), projectIds.slice(i, i + BATCH));
  }
  return n;
}

const byTor = (ids: Types.ObjectId[], pids: string[]) => ({
  $or: [{ torId: { $in: ids } }, { projectId: { $in: pids } }],
});
const stale = { status: { $in: ["pending", "failed"] as QueueStatus[] } };

const counts = {
  documents: await countIn((ids, pids) => DocumentModel.countDocuments(byTor(ids, pids))),
  chunks: await countIn((ids) => ChunkModel.countDocuments({ torId: { $in: ids } })),
  extractionQueue: await countIn((ids, pids) => ExtractionQueueModel.countDocuments(byTor(ids, pids))),
  ingestErrors: await countIn((_ids, pids) => ErrorModel.countDocuments({ projectId: { $in: pids } })),
  ingestQueue: await countIn((_ids, pids) => QueueModel.countDocuments({ projectId: { $in: pids } })),
  staleQueue: await QueueModel.countDocuments(stale),
};

console.log("\nalso deleted:");
for (const [name, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(7)}  ${name}`);
console.log(`  + bundle files and ${env.extractDir}/<projectId> directories for the deleted TORs`);
console.log(`  + the ${SOURCE_ID} watermark (next discovery starts the year from the top)`);

if (!apply) {
  console.log("\nDry run. Re-run with --apply to delete.");
  await disconnectMongo();
  process.exit(0);
}

// Only paths inside our own data directories are ever removed, whatever a
// document row claims its localPath is.
function inside(dir: string, path: string): boolean {
  return resolve(path).startsWith(resolve(dir) + sep);
}

let files = 0;
for (let i = 0; i < torIds.length; i += BATCH) {
  const ids = torIds.slice(i, i + BATCH);
  const pids = projectIds.slice(i, i + BATCH);

  const docs = await DocumentModel.find({ ...byTor(ids, pids), localPath: { $ne: null } }, { localPath: 1 }).lean();
  for (const d of docs) {
    const path = d.localPath!;
    if (inside(env.blobDir, path) || inside(env.extractDir, path)) {
      await rm(path, { force: true });
      files++;
    }
  }
  for (const pid of pids) {
    // A projectId is an e-GP number; anything else must not become a path.
    if (/^\d+$/.test(pid)) await rm(join(env.extractDir, pid), { recursive: true, force: true });
  }

  await Promise.all([
    DocumentModel.deleteMany(byTor(ids, pids)),
    ChunkModel.deleteMany({ torId: { $in: ids } }),
    ExtractionQueueModel.deleteMany(byTor(ids, pids)),
    ErrorModel.deleteMany({ projectId: { $in: pids } }),
    QueueModel.deleteMany({ projectId: { $in: pids } }),
  ]);
  await TorModel.deleteMany({ _id: { $in: ids } });

  console.log(`  ${Math.min(i + BATCH, torIds.length)}/${torIds.length}`);
}

await QueueModel.deleteMany(stale);
await WatermarkModel.deleteOne({ sourceId: SOURCE_ID });

console.log(`\nDone: deleted ${torIds.length} TORs and ${files} files; ${kept} TORs remain.`);
await disconnectMongo();
