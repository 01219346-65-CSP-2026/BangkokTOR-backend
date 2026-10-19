import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { sendPendingEmails } from "./modules/notification/email.service.ts";

// Part B (SCRUM-77): pending notification rows -> one digest email per
// reader, on an interval.
//
//   bun run email-worker
//
// Each pass is self-contained — reads up to EMAIL_BATCH_SIZE pending rows,
// sends, writes the outcome — so a crash between passes loses no state: the
// next pass just picks up whatever is still "pending" (LEARNING.md's
// end-to-end check relies on this to prove nothing is ever sent twice).

let running = true;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function loop() {
  console.log(`email-worker started (interval ${env.emailIntervalMs}ms, batch ${env.emailBatchSize})`);
  while (running) {
    try {
      const result = await sendPendingEmails();
      if (result.sent || result.failed || result.skipped) {
        console.log(`sent ${result.sent}  failed ${result.failed}  skipped ${result.skipped}`);
      }
    } catch (err) {
      console.error("email-worker pass failed:", err);
    }
    await sleep(env.emailIntervalMs);
  }
}

async function shutdown(signal: string) {
  console.log(`\n${signal} — stopping`);
  running = false;
  await disconnectMongo();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await connectMongo();
await loop();
