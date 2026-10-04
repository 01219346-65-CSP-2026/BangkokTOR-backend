import mongoose from "mongoose";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";

// Copy every pipeline collection to <name>_bk_<D>_<M>_<YYYY> — the same naming
// as the 30_9_2026 backups already in the database. Copied server-side with
// $out, so nothing is downloaded. The source collections are never touched.
//
//   bun run backup-collections           # report only
//   bun run backup-collections --apply   # write the copies
//
// Refuses to overwrite a backup that already exists: a second run the same
// day must not replace a good backup with whatever the data has become since.

export const BACKED_UP = [
  "tors",
  "documents",
  "tor_texts",
  "tor_chunks",
  "extraction_queue",
  "ingest_queue",
  "ingest_errors",
  "bookmarks",
  "watermarks",
] as const;

/** "_bk_2_10_2026" for 2 Oct 2026, Bangkok date. */
export function backupSuffix(now: Date = new Date()): string {
  const bkk = new Date(now.getTime() + 7 * 3_600_000);
  return `_bk_${bkk.getUTCDate()}_${bkk.getUTCMonth() + 1}_${bkk.getUTCFullYear()}`;
}

if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  await connectMongo();
  const db = mongoose.connection.db!;
  const suffix = backupSuffix();
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  let refused = 0;
  for (const name of BACKED_UP) {
    const target = name + suffix;
    const n = await db.collection(name).countDocuments();
    if (existing.has(target)) {
      refused++;
      console.log(`  ${name.padEnd(18)} ${String(n).padStart(7)}  → ${target}  EXISTS, not overwritten`);
      continue;
    }
    console.log(`  ${name.padEnd(18)} ${String(n).padStart(7)}  → ${target}`);
    if (apply) {
      await db.collection(name).aggregate([{ $out: target }]).toArray();
      const copied = await db.collection(target).countDocuments();
      if (copied !== n) throw new Error(`${target}: copied ${copied}, expected ${n}`);
    }
  }

  console.log(apply ? `\nDone (${refused} already existed).` : "\nDry run. Re-run with --apply to copy.");
  await disconnectMongo();
}
