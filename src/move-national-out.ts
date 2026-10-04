import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import mongoose, { type Types } from "mongoose";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { backupSuffix } from "./backup-collections.ts";
import { BookmarkModel } from "./modules/bookmark/bookmark.model.ts";
import { ExtractionQueueModel } from "./modules/extract/extraction.model.ts";
import { TorTextModel } from "./modules/extract/torText.model.ts";
import { DocumentModel } from "./modules/ingest/document.model.ts";
import { ErrorModel } from "./modules/ingest/error.model.ts";
import { QueueModel } from "./modules/ingest/queue.model.ts";
import { TorModel } from "./modules/tor/tor.model.ts";

// Take the national (govspending/CKAN) TORs out of the live collections, so
// the site holds only BMA tenders. They are all awarded history; the backup
// (`bun run backup-collections`) keeps them for analysis.
//
//   bun run move-national-out           # report only
//   bun run move-national-out --apply   # delete — only if today's backup holds every row
//
// Same cascade as purge-out-of-scope.ts: documents, texts, chunks, queues,
// errors, bookmarks, then the TORs, plus any local files for those documents.

const BATCH = 2_000;
const apply = process.argv.includes("--apply");

await connectMongo();
const db = mongoose.connection.db!;

const national = { bmaProjectId: null };
const victims = await TorModel.find(national, { _id: 1, projectId: 1 }).lean();
const torIds = victims.map((v) => v._id as Types.ObjectId);
const projectIds = victims.map((v) => v.projectId);
const chunks = db.collection("tor_chunks");

const byTor = (ids: Types.ObjectId[], pids: string[]) => ({
  $or: [{ torId: { $in: ids } }, { projectId: { $in: pids } }],
});

async function countIn(count: (ids: Types.ObjectId[], pids: string[]) => Promise<number>) {
  let n = 0;
  for (let i = 0; i < torIds.length; i += BATCH) {
    n += await count(torIds.slice(i, i + BATCH), projectIds.slice(i, i + BATCH));
  }
  return n;
}

console.log(`tors: ${await TorModel.countDocuments()} total → move out ${victims.length} national, keep ${await TorModel.countDocuments({ bmaProjectId: { $ne: null } })} BMA`);
const counts = {
  documents: await countIn((ids, pids) => DocumentModel.countDocuments(byTor(ids, pids))),
  tor_texts: await countIn((ids) => TorTextModel.countDocuments({ torId: { $in: ids } })),
  tor_chunks: await countIn((ids) => chunks.countDocuments({ torId: { $in: ids } })),
  extraction_queue: await countIn((ids, pids) => ExtractionQueueModel.countDocuments(byTor(ids, pids))),
  ingest_errors: await countIn((_ids, pids) => ErrorModel.countDocuments({ projectId: { $in: pids } })),
  ingest_queue: await countIn((_ids, pids) => QueueModel.countDocuments({ projectId: { $in: pids } })),
  bookmarks: await countIn((ids) => BookmarkModel.countDocuments({ torId: { $in: ids } })),
};
for (const [name, n] of Object.entries(counts)) console.log(`  ${String(n).padStart(7)}  ${name}`);

// Nothing is deleted that the backup does not hold.
const backup = `tors${backupSuffix()}`;
const backedUp = await countIn((ids) => db.collection(backup).countDocuments({ _id: { $in: ids } }));
console.log(`\n${backup} holds ${backedUp} of the ${victims.length} rows to move out.`);

if (!apply) {
  console.log("Dry run. Re-run with --apply to delete.");
  await disconnectMongo();
  process.exit(0);
}
if (victims.length === 0 || backedUp !== victims.length) {
  console.error(`Refusing: run \`bun run backup-collections --apply\` first (backup has ${backedUp}/${victims.length}).`);
  await disconnectMongo();
  process.exit(1);
}

// Only paths inside our own data directories are ever removed.
const inside = (dir: string, path: string) => resolve(path).startsWith(resolve(dir) + sep);

for (let i = 0; i < torIds.length; i += BATCH) {
  const ids = torIds.slice(i, i + BATCH);
  const pids = projectIds.slice(i, i + BATCH);

  const docs = await DocumentModel.find({ ...byTor(ids, pids), localPath: { $ne: null } }, { localPath: 1 }).lean();
  for (const d of docs) {
    if (inside(env.blobDir, d.localPath!) || inside(env.extractDir, d.localPath!)) await rm(d.localPath!, { force: true });
  }
  for (const pid of pids) {
    // A projectId is an e-GP number; anything else must not become a path.
    if (/^\d+$/.test(pid)) await rm(join(env.extractDir, pid), { recursive: true, force: true });
  }

  await Promise.all([
    DocumentModel.deleteMany(byTor(ids, pids)),
    TorTextModel.deleteMany({ torId: { $in: ids } }),
    chunks.deleteMany({ torId: { $in: ids } }),
    ExtractionQueueModel.deleteMany(byTor(ids, pids)),
    ErrorModel.deleteMany({ projectId: { $in: pids } }),
    QueueModel.deleteMany({ projectId: { $in: pids } }),
    BookmarkModel.deleteMany({ torId: { $in: ids } }),
  ]);
  await TorModel.deleteMany({ _id: { $in: ids } });
  console.log(`  ${Math.min(i + BATCH, torIds.length)}/${torIds.length}`);
}

console.log(`Done. tors now ${await TorModel.countDocuments()}.`);
await disconnectMongo();
