import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

export const WORKER_KINDS = ["ingest", "extract", "grade"] as const;
export type WorkerKind = (typeof WORKER_KINDS)[number];

export const WORKER_STATES = ["idle", "working", "stopping"] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

// A worker process announcing itself. One document per process, keyed by the
// same `${hostname}-${pid}` string the queue rows already carry in claimedBy,
// so a working row and its worker can be joined on sight.
//
// Liveness is NOT stored. A crashed worker runs no cleanup, so any field it
// wrote saying "I am alive" would still say so after it died. The only honest
// signal is when it last spoke: lastBeatAt, compared against now by the reader.
// That is the same reasoning that makes claimedAt load-bearing in claim.ts.

const heartbeatSchema = new Schema(
  {
    // The worker id, not an ObjectId — a restarted process gets a new pid and
    // therefore a new row, which is correct: it is a different run.
    _id: { type: String, required: true },

    kind: { type: String, enum: WORKER_KINDS, required: true },
    host: { type: String, required: true },
    pid: { type: Number, required: true },

    startedAt: { type: Date, required: true },
    lastBeatAt: { type: Date, required: true },

    state: { type: String, enum: WORKER_STATES, default: "idle", required: true },

    // What it is working on right now — the row label (a projectId, in every
    // current worker). Null while idle. This is the "which task" of the
    // monitoring page.
    currentLabel: { type: String, default: null },
    currentSince: { type: Date, default: null },

    processedThisRun: { type: Number, default: 0 },
    failedThisRun: { type: Number, default: 0 },
  },
  { versionKey: false, collection: "worker_heartbeats", _id: false },
);

// The status endpoint sorts by kind then start time; dead rows are swept by age.
heartbeatSchema.index({ lastBeatAt: -1 });

export type HeartbeatRow = InferSchemaType<typeof heartbeatSchema>;
export type HeartbeatDoc = HydratedDocument<HeartbeatRow>;
export type HeartbeatLean = HeartbeatRow & { _id: string };

export const HeartbeatModel = model<HeartbeatRow>("WorkerHeartbeat", heartbeatSchema);
