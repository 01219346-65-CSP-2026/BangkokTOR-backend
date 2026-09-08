import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { createRunner } from "./lib/worker/runQueue.ts";
import { processRow, recordError } from "./modules/ingest/ingest.service.ts";
import { QueueModel, type QueueDoc } from "./modules/ingest/queue.model.ts";

// A standalone process, not part of the API (NFR-01). Ingestion never runs in a
// request, and an ingestion crash must not take the dashboard down with it.
//
//   bun run worker
//
// Safe to run N-up: claimNext is atomic, so eight of these compete for rows
// without ever claiming the same one.

const runner = createRunner<QueueDoc>({
  name: "ingest-worker",
  model: QueueModel,
  process: (row) => processRow(row),
  label: (row) => row.projectId,
  onError: (row, message) =>
    recordError({ projectId: row.projectId, kind: "worker-threw", message }),
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
