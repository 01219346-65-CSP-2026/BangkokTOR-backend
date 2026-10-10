import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { classifyTor, CLASSIFIER_VERSION } from "./lib/classify/index.ts";
import { TorModel } from "./modules/tor/tor.model.ts";

// Re-run the classifier over stored TORs whose classification is older than
// CLASSIFIER_VERSION — today, to give every TOR its workTypes (v2). Reads only
// fields already on the row; no network.
//
//   bun run backfill-classify            # report only
//   bun run backfill-classify --apply    # write
//
// New TORs are classified on arrival (ingest.service.ts processRow), and a
// discovery rescan refreshes the ones it sees; this covers the rest.

const apply = process.argv.includes("--apply");

await connectMongo();

const todo = await TorModel.find(
  { classifierVersion: { $ne: CLASSIFIER_VERSION } },
  { projectName: 1, goodsCategory: 1, procurementType: 1, procurementMethod: 1, projectStatus: 1, isSoftware: 1 },
).lean();

console.log(`${todo.length} TORs classified by an older version (current v${CLASSIFIER_VERSION}).`);

const tally = new Map<string, number>();
let flipped = 0;
// Plain arrays (softwareSignals, workTypeSignals) don't satisfy Mongoose's
// DocumentArray typing in a bulk update; the stored shape is identical.
const writes: Array<{ updateOne: { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } } }> = [];

for (const tor of todo) {
  const c = classifyTor({
    projectName: tor.projectName,
    goodsCategory: tor.goodsCategory,
    procurementType: tor.procurementType,
    procurementMethod: tor.procurementMethod,
    projectStatus: tor.projectStatus,
  });
  for (const t of c.workTypes) tally.set(t, (tally.get(t) ?? 0) + 1);
  // The software rules didn't change in v2; a flip here means a stored row
  // predates them and deserves a look, not a silent rewrite.
  if (tor.isSoftware !== null && tor.isSoftware !== c.isSoftware) flipped++;
  writes.push({ updateOne: { filter: { _id: tor._id }, update: { $set: c } } });
}

console.log("work types:", Object.fromEntries([...tally].sort((a, b) => b[1] - a[1])));
if (flipped) console.log(`note: ${flipped} rows would change isSoftware.`);

if (apply) {
  for (let i = 0; i < writes.length; i += 500) {
    await TorModel.bulkWrite(writes.slice(i, i + 500) as Parameters<typeof TorModel.bulkWrite>[0]);
  }
  console.log(`Done: reclassified ${writes.length} TORs.`);
} else {
  console.log("Dry run. Re-run with --apply to write.");
}

await disconnectMongo();
