import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { createRunner } from "./lib/worker/runQueue.ts";
import { processBundle } from "./modules/extract/extract.service.ts";
import { ExtractionQueueModel, type ExtractionDoc } from "./modules/extract/extraction.model.ts";
import { recordError } from "./modules/ingest/ingest.service.ts";

// The extraction worker (stage ④–⑤): expand a bundle, read the PDFs, triage
// digital vs scanned, chunk what is readable.
//
//   bun run extract-worker
//
// Kept a SEPARATE process from the ingest worker on purpose: extraction spawns
// a JVM and is CPU-bound, while ingestion is bound by the 400ms politeness
// delay. Scaling one should not mean scaling the other.

const runner = createRunner<ExtractionDoc>({
  name: "extract-worker",
  kind: "extract",
  model: ExtractionQueueModel,
  process: (row) =>
    processBundle({
      _id: row._id,
      projectId: row.projectId,
      torId: row.torId,
      documentId: row.documentId,
      localPath: row.localPath,
    }),
  label: (row) => row.projectId,
  onError: (row, message) =>
    recordError({ projectId: row.projectId, kind: "extract-worker-threw", message }),
});

async function shutdown(signal: string) {
  await runner.shutdown(signal);
  await disconnectMongo();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await connectMongo();
await runner.loop();
await disconnectMongo();
