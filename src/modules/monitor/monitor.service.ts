import { Types, type Model } from "mongoose";
import { env } from "../../config/env.ts";
import { mongoState, pingMongo } from "../../db/mongo.ts";
import { getStatus } from "../ingest/ingest.service.ts";
import { getExtractStatus } from "../extract/extract.service.ts";
import { getGradeStatus } from "../grade/grade.service.ts";
import { QueueModel } from "../ingest/queue.model.ts";
import { RunModel } from "../ingest/run.model.ts";
import { ErrorModel } from "../ingest/error.model.ts";
import { ExtractionQueueModel } from "../extract/extraction.model.ts";
import { TorModel, TOR_STATUSES } from "../tor/tor.model.ts";
import { HeartbeatModel } from "./heartbeat.model.ts";
import { HttpError } from "../../middleware/errors.ts";

export type WorkerHealth = "live" | "stale" | "dead";

// A worker is judged only by when it last spoke. Three missed beats is stale
// (it may just be slow); a full lease of silence is dead, because by then the
// queue has already taken its rows away and given them to someone else.
const STALE_AFTER = () => env.heartbeatMs * 3;
const DEAD_AFTER = () => env.workerLeaseMs;

export function healthOf(lastBeatAt: Date, now: number): WorkerHealth {
  const silentFor = now - lastBeatAt.getTime();
  if (silentFor > DEAD_AFTER()) return "dead";
  if (silentFor > STALE_AFTER()) return "stale";
  return "live";
}

const LATENCY_SAMPLE = 50;

// Median, not mean: one wedged row holding a 15-minute lease would drag a mean
// far away from what the typical row actually looks like.
function median(values: (number | null)[]): number | null {
  const sorted = values.filter((n): n is number => n !== null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Everything the monitoring page needs, in one round trip.
 *
 * The three stage summaries are the existing service functions rather than
 * fresh queries — the dashboard must not be able to disagree with
 * /api/ingest/status about what is in the queue.
 */
export async function getPipelineStatus() {
  const now = Date.now();

  const [mongoOk, ingest, extract, grade, heartbeats, torCounts, claims, errorKinds, recentDone] =
    await Promise.all([
      pingMongo(),
      getStatus(),
      getExtractStatus(),
      getGradeStatus(),
      HeartbeatModel.find().sort({ kind: 1, startedAt: 1 }).lean(),
      TorModel.aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
      // Claim ages of everything currently in flight, for "how long has work
      // been held". Small by definition — only `working` rows have a claim.
      Promise.all([
        QueueModel.find({ status: "working", claimedAt: { $ne: null } })
          .select("claimedAt")
          .lean(),
        ExtractionQueueModel.find({ status: "working", claimedAt: { $ne: null } })
          .select("claimedAt")
          .lean(),
      ]),
      // The failure mix behind the headline count, so the strip can say what
      // actually went wrong rather than just how much.
      ErrorModel.aggregate<{ _id: string; n: number }>([
        { $group: { _id: "$kind", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      // The last few finished rows per stage, for "how long does one row take".
      // heldMs is stamped by the runner after release (runQueue.ts) — release
      // clears claimedAt, so it cannot be derived from the row afterwards.
      // Rows finished before heldMs existed have none, and are skipped.
      Promise.all([
        QueueModel.find({ status: "done", heldMs: { $ne: null } })
          .sort({ updatedAt: -1 })
          .limit(LATENCY_SAMPLE)
          .select("heldMs")
          .lean(),
        ExtractionQueueModel.find({ status: "done", heldMs: { $ne: null } })
          .sort({ updatedAt: -1 })
          .limit(LATENCY_SAMPLE)
          .select("heldMs")
          .lean(),
      ]),
    ]);

  // Every status present, including the zeroes — a funnel with missing stages
  // reads as "no data" when it means "nothing has got that far yet".
  const torStatusCounts: Record<string, number> = Object.fromEntries(
    TOR_STATUSES.map((s) => [s, 0]),
  );
  for (const c of torCounts) torStatusCounts[c._id] = c.n;

  const medianAge = (rows: { claimedAt?: Date | null }[]): number | null =>
    median(rows.map((r) => (r.claimedAt ? now - new Date(r.claimedAt).getTime() : null)));

  const medianHeld = (rows: { heldMs?: number | null }[]) =>
    median(rows.map((r) => r.heldMs ?? null));

  return {
    generatedAt: new Date(now).toISOString(),
    mongo: { ok: mongoOk, state: mongoState() },
    stages: { ingest, extract, grade },
    // Median age of an in-flight claim, per stage. Null when nothing is held.
    claimAgeMs: {
      ingest: medianAge(claims[0]),
      extract: medianAge(claims[1]),
    },
    // Median time one finished row was held, over the last LATENCY_SAMPLE.
    // Grading has no queue rows to time. Null before anything has finished.
    latencyMs: {
      ingest: medianHeld(recentDone[0]),
      extract: medianHeld(recentDone[1]),
    },
    // Failure counts by kind, most common first.
    errorsByKind: errorKinds.map((e) => ({ kind: e._id, count: e.n })),
    workers: heartbeats.map((h) => {
      const health = healthOf(h.lastBeatAt, now);
      return {
        id: h._id,
        kind: h.kind,
        host: h.host,
        pid: h.pid,
        state: h.state,
        health,
        currentLabel: h.currentLabel ?? null,
        currentSince: h.currentSince ?? null,
        startedAt: h.startedAt,
        lastBeatAt: h.lastBeatAt,
        processedThisRun: h.processedThisRun,
        failedThisRun: h.failedThisRun,
        // "Was working when it went quiet" — a worker that died holding a row
        // is a different problem from one that died idle, and the row it was
        // holding is still leased until the lease expires.
        wasWorking: health !== "live" && h.state === "working",
        stopRequestedAt: h.stopRequestedAt ?? null,
      };
    }),
    torStatusCounts,
    // getStatus already reads the last 100 ingest_errors; lifted to the top
    // level because errors are a property of the pipeline, not of ingestion.
    recentErrors: ingest.recentErrors,
  };
}

// The two queues have the same claim shape but different result columns, so
// their Mongoose types don't unify. `Model<any>` here is deliberate: this reads
// only the fields both collections share, and the response is mapped by hand
// below.
const STAGE_MODELS: Record<"ingest" | "extract", Model<any>> = {
  ingest: QueueModel,
  extract: ExtractionQueueModel,
};

export type QueueStage = keyof typeof STAGE_MODELS;

export const isQueueStage = (v: string): v is QueueStage => v in STAGE_MODELS;

/** One page of queue rows, newest activity first. */
export async function listQueueRows(input: {
  stage: QueueStage;
  status?: string;
  page: number;
  limit: number;
}) {
  const model = STAGE_MODELS[input.stage];
  const filter: Record<string, unknown> = input.status ? { status: input.status } : {};
  const limit = Math.min(Math.max(input.limit, 1), 100);
  const page = Math.max(input.page, 1);

  const [items, total] = await Promise.all([
    model
      .find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    model.countDocuments(filter),
  ]);

  return {
    items: items.map((r: any) => ({
      id: String(r._id),
      projectId: r.projectId,
      status: r.status,
      attempts: r.attempts,
      claimedBy: r.claimedBy ?? null,
      claimedAt: r.claimedAt ?? null,
      reason: r.reason ?? null,
      updatedAt: r.updatedAt,
      // Extraction rows carry result counters; ingest rows do not.
      pdfCount: r.pdfCount ?? null,
      textChars: r.textChars ?? null,
    })),
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
  };
}

/** Run history. Only the latest run is exposed elsewhere. */
export async function listRuns(limit: number) {
  const capped = Math.min(Math.max(limit, 1), 100);
  const runs = await RunModel.find().sort({ startedAt: -1 }).limit(capped).lean();

  return runs.map((r) => ({
    id: String(r._id),
    kind: r.kind,
    status: r.status,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    counts: r.counts,
    error: r.error ?? null,
  }));
}

// ── Controls ────────────────────────────────────────────────────────────────
// The only writes the dashboard can make. Each is small and reversible in
// effect: a stop finishes the current row, a flush only drops rows for
// processes that are already gone, and a retry puts one row back in line.

/** Ask workers to stop after their current row. Returns how many were flagged. */
export async function requestStop(ids: string[]) {
  const result = await HeartbeatModel.updateMany(
    { _id: { $in: ids }, stopRequestedAt: null },
    { $set: { stopRequestedAt: new Date() } },
  );
  return { flagged: result.modifiedCount };
}

/**
 * Which heartbeat rows a flush removes: dead ones, plus workers that said
 * "stopping" and have since gone quiet. A live worker is never flushed — its
 * next beat would upsert the row straight back with a fresh startedAt, and the
 * dashboard would report a restart that never happened.
 */
export function isFlushable(row: { lastBeatAt: Date; state: string }, now: number): boolean {
  const health = healthOf(row.lastBeatAt, now);
  return health === "dead" || (row.state === "stopping" && health !== "live");
}

/** Delete heartbeat rows for workers that are gone. */
export async function flushDeadWorkers() {
  const now = Date.now();
  const rows = await HeartbeatModel.find().select("lastBeatAt state").lean();
  const ids = rows.filter((r) => isFlushable(r, now)).map((r) => r._id);
  if (ids.length === 0) return { removed: 0 };
  const result = await HeartbeatModel.deleteMany({ _id: { $in: ids } });
  return { removed: result.deletedCount };
}

/**
 * Kinds a retry cannot fix. Oversize is decided by maxBundleBytes, not by
 * luck: the same download will be the same size next time (ingest.service.ts).
 */
export const NON_RETRYABLE_KINDS = new Set(["oversize"]);

/** Put the ingest queue row behind an error back to pending. */
export async function retryError(errorId: string) {
  if (!Types.ObjectId.isValid(errorId)) throw new HttpError(404, `No error ${errorId}`);

  const error = await ErrorModel.findById(errorId).lean();
  if (!error) throw new HttpError(404, `No error ${errorId}`);
  if (NON_RETRYABLE_KINDS.has(error.kind)) {
    throw new HttpError(409, `"${error.kind}" errors are not retryable`);
  }
  if (!error.projectId) throw new HttpError(409, "This error has no project to retry");

  // Only a settled row: requeueing a "working" one would hand it to a second
  // worker while the first still holds it.
  const row = await QueueModel.findOneAndUpdate(
    {
      sourceId: error.sourceId,
      projectId: error.projectId,
      status: { $in: ["done", "failed"] },
    },
    { $set: { status: "pending", claimedBy: null, claimedAt: null, reason: null } },
    { new: true },
  ).lean();

  if (!row) {
    const exists = await QueueModel.exists({ sourceId: error.sourceId, projectId: error.projectId });
    throw exists
      ? new HttpError(409, `${error.projectId} is already queued or in progress`)
      : new HttpError(404, `No queue row for ${error.projectId}`);
  }

  return { projectId: row.projectId, status: row.status };
}
