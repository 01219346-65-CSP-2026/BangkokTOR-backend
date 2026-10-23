import { Types } from "mongoose";
import { env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";
import { createSummarizer, sanitizeBullets } from "./lib/ai/index.ts";
import { assertVertexConfig } from "./lib/ai/vertex.ts";
import { TorTextModel } from "./modules/extract/torText.model.ts";
import { recordError } from "./modules/ingest/ingest.service.ts";
import { SUMMARY_VERSION, TorModel } from "./modules/tor/tor.model.ts";

// Summarize TORs with stored text without running the grader.
//
//   bun run summarize-worker             # process stale summaries until stopped
//   bun run summarize-worker <tor-id>    # summarize one specific TOR, then exit

const requestedId = process.argv[2];
const failedIds = new Set<string>();
let running = true;
let summarized = 0;
let failed = 0;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function requestStop(signal: string) {
  console.log(`\n${signal} — finishing current TOR, then stopping`);
  running = false;
}

process.once("SIGINT", () => requestStop("SIGINT"));
process.once("SIGTERM", () => requestStop("SIGTERM"));

async function nextTor() {
  if (requestedId) {
    if (!Types.ObjectId.isValid(requestedId)) {
      throw new Error(`Invalid TOR id: ${requestedId}`);
    }
    return TorModel.findById(requestedId).select("_id projectId").lean();
  }

  const textTorIds = await TorTextModel.distinct("torId");
  return TorModel.findOne({
    _id: { $in: textTorIds, $nin: [...failedIds] },
    $or: [
      { summaryVersion: null },
      { summaryVersion: { $lt: SUMMARY_VERSION } },
    ],
  })
    .select("_id projectId")
    .sort({ createdAt: 1 })
    .lean();
}

async function summarizeTor(tor: { _id: Types.ObjectId; projectId: string }) {
  const startedAt = Date.now();

  try {
    const storedText = await TorTextModel.findOne({ torId: tor._id }).lean();
    if (!storedText) {
      throw new Error("TOR has no stored text");
    }

    const summarizer = createSummarizer();
    const bullets = sanitizeBullets(
      await summarizer.summarize({
        text: storedText.fullText,
        files: storedText.files,
      }),
    );

    await TorModel.updateOne(
      { _id: tor._id },
      {
        $set: {
          summaryBullets: sanitizeBullets(bullets),
          summarizedAt: bullets.length > 0 ? new Date() : null,
          summaryVersion: SUMMARY_VERSION,
          summaryModel: summarizer.id,
        },
      },
    );

    summarized++;
    console.log(
      `ok   ${tor.projectId}  ${bullets.length} points  ${((Date.now() - startedAt) / 1000).toFixed(0)}s  (${summarized} summarized)`,
    );
    return true;
  } catch (error) {
    failed++;
    failedIds.add(String(tor._id));

    try {
      await recordError({
        projectId: tor.projectId,
        kind: "summarize-worker-failed",
        message: String(error),
      });
    } catch (recordingError) {
      console.error(`could not record summarize failure for ${tor.projectId}:`, recordingError);
    }

    console.error(`fail ${tor.projectId}:`, error);
    return false;
  }
}

async function loop() {
  assertVertexConfig();
  console.log(`summarize-worker started (model ${env.vertexModel})`);

  let idleLogged = false;
  while (running) {
    const tor = await nextTor();

    if (!tor) {
      if (requestedId) {
        console.error(`TOR not found or has no pending summary: ${requestedId}`);
        failed++;
        break;
      }

      if (!idleLogged) {
        console.log(`nothing to summarize (summary version ${SUMMARY_VERSION}) — waiting`);
        idleLogged = true;
      }
      await sleep(env.workerIdleMs);
      continue;
    }

    idleLogged = false;
    await summarizeTor(tor);

    if (requestedId) break;
  }

  console.log(`summarize-worker stopped — ${summarized} summarized, ${failed} failed`);
}

await connectMongo();
try {
  await loop();
} catch (error) {
  console.error("summarize-worker stopped unexpectedly:", error);
  process.exitCode = 1;
} finally {
  await disconnectMongo();
}
