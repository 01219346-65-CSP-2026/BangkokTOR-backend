import mongoose, { type Types } from "mongoose";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { backupSuffix } from "./backup-collections.ts";

// Put backed-up TORs back into the live collections — the reverse of
// move-national-out.ts. Copied server-side with $merge, so nothing is
// downloaded, and nothing already live is ever overwritten.
//
//   bun run restore-from-backup                      # report only, today's backup
//   bun run restore-from-backup --apply
//   bun run restore-from-backup --from 2_10_2026     # a named day's backup
//
// A backed-up TOR is skipped when its project is live again under a new _id
// (BMA discovery re-found it after the move): the live row is newer, and the
// unique {sourceId, projectId} index could not hold both.

const apply = process.argv.includes("--apply");
const at = process.argv.indexOf("--from");
const suffix = at >= 0 ? `_bk_${process.argv[at + 1]}` : backupSuffix();

// Watermarks are not restored: the live one is the current discovery state.
const DEPENDENTS = [
  { name: "documents", key: "both" },
  { name: "tor_texts", key: "torId" },
  { name: "tor_chunks", key: "torId" },
  { name: "extraction_queue", key: "both" },
  { name: "ingest_queue", key: "projectId" },
  { name: "ingest_errors", key: "projectId" },
  { name: "bookmarks", key: "torId" },
] as const;

await connectMongo();
const db = mongoose.connection.db!;
const backupTors = db.collection(`tors${suffix}`);

if ((await backupTors.estimatedDocumentCount()) === 0) {
  console.error(`tors${suffix} is missing or empty — nothing to restore.`);
  await disconnectMongo();
  process.exit(1);
}

const live = await db.collection("tors").find({}, { projection: { _id: 1, projectId: 1 } }).toArray();
const liveIds = live.map((t) => t._id);
const livePids = live.map((t) => t.projectId as string);

const restorable = await backupTors
  .find({ _id: { $nin: liveIds }, projectId: { $nin: livePids } }, { projection: { _id: 1, projectId: 1 } })
  .toArray();
const ids = restorable.map((t) => t._id as Types.ObjectId);
const pids = restorable.map((t) => t.projectId as string);
const skipped = (await backupTors.countDocuments()) - restorable.length;

const filterFor = (key: (typeof DEPENDENTS)[number]["key"]) =>
  key === "torId"
    ? { torId: { $in: ids } }
    : key === "projectId"
      ? { projectId: { $in: pids } }
      : { $or: [{ torId: { $in: ids } }, { projectId: { $in: pids } }] };

const plan: Array<{ name: string; filter: Record<string, unknown> }> = [
  { name: "tors", filter: { _id: { $in: ids } } },
  ...DEPENDENTS.map((d) => ({ name: d.name, filter: filterFor(d.key) })),
];

console.log(`From *${suffix}: restore ${restorable.length} TORs (${skipped} skipped: already live, or live again under a new id).`);
for (const { name, filter } of plan) {
  const n = await db.collection(name + suffix).countDocuments(filter);
  console.log(`  ${String(n).padStart(7)}  ${name}`);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to restore.");
  await disconnectMongo();
  process.exit(0);
}

for (const { name, filter } of plan) {
  await db
    .collection(name + suffix)
    .aggregate([{ $match: filter }, { $merge: { into: name, on: "_id", whenMatched: "keepExisting", whenNotMatched: "insert" } }])
    .toArray();
  console.log(`  restored ${name}`);
}

console.log(`Done. tors now ${await db.collection("tors").countDocuments()}.`);
await disconnectMongo();
