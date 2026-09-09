import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { findUngraded, gradeTor } from "./modules/grade/grade.service.ts";
import { recordError } from "./modules/ingest/ingest.service.ts";

// The grading worker (stage ⑥): stored chunks -> rule findings -> a grade.
//
//   bun run grade-worker
//
// Unlike the ingest and extraction workers this has NO queue collection, so it
// does not use claim.ts. `findUngraded` is the claim condition: a TOR at
// `extraction_pending` whose graderVersion is missing or stale. That is enough
// because grading is idempotent — regrading a TOR overwrites its findings
// rather than appending, so a crashed run costs time, never correctness.
//
// The tradeoff: two of these running at once would grade the same TOR twice and
// waste model time. Run one. If that ever needs to change, the honest fix is a
// grade_queue with the same claim/lease mechanics as the other two, not a lock
// bolted onto this loop.

let running = true;
let inFlight = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loop() {
  console.log(`grade-worker started (provider ${env.aiProvider}, model ${env.ollamaModel})`);

  let graded = 0;
  let failed = 0;
  let idleLogged = false;

  while (running) {
    // One at a time: grading is minutes long, and a batch would only widen the
    // window in which a shutdown loses work.
    const [tor] = await findUngraded(1);

    if (!tor) {
      if (!idleLogged) {
        console.log("nothing to grade — waiting");
        idleLogged = true;
      }
      await sleep(env.workerIdleMs);
      continue;
    }

    idleLogged = false;
    inFlight = true;
    const started = Date.now();

    try {
      const result = await gradeTor(tor._id);
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);

      if (result.ok) {
        graded++;
        console.log(`ok   ${tor.projectId}  grade ${result.grade}  ${elapsed}s  (${graded} graded)`);
      } else {
        failed++;
        // gradeTor already moved the TOR off extraction_pending for the cases
        // it can diagnose (no-chunks), so this will not spin on the same row.
        console.log(`fail ${tor.projectId}  ${result.reason}  ${elapsed}s`);
      }
    } catch (error) {
      failed++;
      await recordError({
        projectId: tor.projectId,
        kind: "grade-worker-threw",
        message: String(error),
      });
      console.error(`throw ${tor.projectId}:`, error);
    } finally {
      inFlight = false;
    }
  }

  console.log(`grade-worker stopped — ${graded} graded, ${failed} failed`);
}

// Grading one TOR takes 1-3 minutes. Abandoning it mid-way leaves a TOR with
// chunks and no grade, which the next run picks up anyway — but finishing is
// cheaper than repeating, so the deadline is generous.
async function shutdown(signal: string) {
  console.log(`\n${signal} — finishing current TOR, then stopping`);
  running = false;

  const deadline = Date.now() + 240_000;
  while (inFlight && Date.now() < deadline) await sleep(500);

  await disconnectMongo();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await connectMongo();
await loop();
await disconnectMongo();
