import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { ExtractionQueueModel } from "./modules/extract/extraction.model.ts";
import { DocumentModel } from "./modules/ingest/document.model.ts";

// Delete bundle zips and extracted PDFs nothing needs any more — the backlog
// from before extraction started discarding them (extract.service.ts
// discardFiles), and anything orphaned by collections that were backed up and
// replaced. Safe to run while the workers are up.
//
//   bun run cleanup-document-files            # report only
//   bun run cleanup-document-files --apply    # delete
//
// Kept, because a worker still needs them:
//   - a bundle whose extraction hasn't reached a final outcome — not yet
//     queued, pending, working, or failed (a failed row can be retried) —
//     and its project's extract directory;
//   - in-flight downloads (*.part);
//   - anything modified in the last 30 minutes: a worker writes the file
//     before it records it, and this must not delete it in between.
// data/source (the govspending bulk zip) is not touched: discovery reads it,
// and deletes it itself after a full scan.

const apply = process.argv.includes("--apply");
const GRACE_MS = 30 * 60_000;

await connectMongo();

const finished = new Set(
  (await ExtractionQueueModel.find({ status: "done" }, { documentId: 1 }).lean()).map((r) => String(r.documentId)),
);

// Bundles still on disk whose extraction isn't done: these stay.
const liveBundles = await DocumentModel.find({ kind: "bundle", localPath: { $ne: null } }, { localPath: 1, projectId: 1 }).lean();
const keepFiles = new Set<string>();
const keepProjects = new Set<string>();
for (const b of liveBundles) {
  if (finished.has(String(b._id))) continue;
  keepFiles.add(resolve(b.localPath!));
  keepProjects.add(b.projectId);
}

const now = Date.now();
const recent = async (path: string) => now - (await stat(path)).mtimeMs < GRACE_MS;

async function sizeOf(path: string): Promise<number> {
  const s = await stat(path);
  if (!s.isDirectory()) return s.size;
  let total = 0;
  for (const entry of await readdir(path)) total += await sizeOf(join(path, entry));
  return total;
}

const doomed: { path: string; bytes: number }[] = [];
let keptBytes = 0;

// Bundles: one zip per document.
for (const name of await readdir(env.blobDir).catch(() => [])) {
  const path = resolve(join(env.blobDir, name));
  const bytes = await sizeOf(path);
  if (name.endsWith(".part") || keepFiles.has(path) || (await recent(path))) keptBytes += bytes;
  else doomed.push({ path, bytes });
}

// Extracted PDFs: one directory per project.
for (const name of await readdir(env.extractDir).catch(() => [])) {
  const path = resolve(join(env.extractDir, name));
  const bytes = await sizeOf(path);
  if (keepProjects.has(name) || (await recent(path))) keptBytes += bytes;
  else doomed.push({ path, bytes });
}

const gb = (n: number) => `${(n / 1e9).toFixed(1)} GB`;
const total = doomed.reduce((sum, d) => sum + d.bytes, 0);
console.log(`delete: ${doomed.length} files/dirs, ${gb(total)}`);
console.log(`keep:   ${keepFiles.size} bundles awaiting extraction, ${keepProjects.size} project dirs, ${gb(keptBytes)} (incl. recent/in-flight)`);

if (!apply) {
  console.log("Dry run. Re-run with --apply to delete.");
  await disconnectMongo();
  process.exit(0);
}

for (const d of doomed) await rm(d.path, { recursive: true, force: true });

// Rows in the current collections that pointed at deleted files: clear the
// path, so the site links to the e-GP bundle instead of a missing file.
const deleted = doomed.map((d) => d.path);
const docs = await DocumentModel.find({ localPath: { $ne: null } }, { localPath: 1 }).lean();
const stale = docs.filter((d) => deleted.some((p) => resolve(d.localPath!) === p || resolve(d.localPath!).startsWith(p + "/")));
if (stale.length) {
  await DocumentModel.updateMany({ _id: { $in: stale.map((d) => d._id) } }, { $set: { localPath: null } });
}

console.log(`Done: deleted ${gb(total)}; cleared localPath on ${stale.length} document rows.`);
await disconnectMongo();
