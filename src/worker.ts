import { hostname } from "node:os";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { claimNext, release } from "./modules/ingest/claim.ts";
import { QueueModel } from "./modules/ingest/queue.model.ts";
import { processRow, recordError } from "./modules/ingest/ingest.service.ts";

// A standalone process, not part of the API (NFR-01). Ingestion never runs in a
// request, and an ingestion crash must not take the dashboard down with it.
//
//   bun run worker
//
// Safe to run N-up: claimNext is atomic, so eight of these compete for rows
// without ever claiming the same one.

const WORKER_ID = `${hostname()}-${process.pid}`;

let running = true;
let inFlight = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loop() {
  console.log(`worker ${WORKER_ID} started (lease ${env.workerLeaseMs}ms)`);

  let processed = 0;
  let idleLogged = false;

  while (running) {
    const row = await claimNext(QueueModel, WORKER_ID, env.workerLeaseMs);

    if (!row) {
      if (!idleLogged) {
        console.log("queue empty — waiting");
        idleLogged = true;
      }
      await sleep(env.workerIdleMs);
      continue;
    }

    idleLogged = false;
    inFlight = true;

    try {
      const result = await processRow(row);
      await release(QueueModel, row, result);
      processed++;
      console.log(
        `${result.ok ? "ok  " : "fail"} ${row.projectId}  (attempt ${row.attempts}, ${processed} done this run)`,
      );
    } catch (error) {
      // An unexpected throw still has to release the row, or it sits at
      // "working" until the lease expires and wastes a lease period.
      await recordError({
        projectId: row.projectId,
        kind: "worker-threw",
        message: String(error),
      });
      await release(QueueModel, row, { ok: false, reason: String(error) });
      console.error(`throw ${row.projectId}:`, error);
    } finally {
      inFlight = false;
    }
  }

  console.log(`worker ${WORKER_ID} stopped after ${processed} rows`);
}

// A clean stop finishes the current row first. A crash doesn't get to — that
// case is covered by the lease, which is the whole reason claimedAt exists.
async function shutdown(signal: string) {
  console.log(`\n${signal} — finishing current row, then stopping`);
  running = false;

  const deadline = Date.now() + 30_000;
  while (inFlight && Date.now() < deadline) await sleep(200);

  await disconnectMongo();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await connectMongo();
await loop();
await disconnectMongo();
