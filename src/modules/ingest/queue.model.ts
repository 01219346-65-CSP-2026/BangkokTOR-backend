import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

export const QUEUE_STATUSES = ["pending", "working", "done", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

const queueSchema = new Schema(
  {
    sourceId: { type: String, required: true },
    projectId: { type: String, required: true },

    status: { type: String, enum: QUEUE_STATUSES, default: "pending", required: true },

    claimedBy: { type: String, default: null },
    // Load-bearing while status is "working": a claim older than the lease is
    // the only evidence a crashed worker leaves behind.
    claimedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    reason: { type: String, default: null },

    // The raw source row, carried so the worker needn't re-fetch discovery.
    payload: { type: Schema.Types.Mixed, default: {} },
    // The declared header at discovery time. Without it the row can't be
    // realigned and a company name gets filed as a latitude.
    header: { type: [String], default: [] },
    sourceUrl: { type: String, default: "" },

    runId: { type: Schema.Types.ObjectId, ref: "IngestRun", default: null },
  },
  { timestamps: true, versionKey: false, collection: "ingest_queue" },
);

// Re-discovering a project must not enqueue it twice.
queueSchema.index({ sourceId: 1, projectId: 1 }, { unique: true });

// claimNext's $or hits this. Without it every poll from every worker
// collection-scans 511k rows.
queueSchema.index({ status: 1, claimedAt: 1 });

export type QueueRow = InferSchemaType<typeof queueSchema>;
export type QueueDoc = HydratedDocument<QueueRow>;
export type QueueLean = QueueRow & { _id: Types.ObjectId };

export const QueueModel = model<QueueRow>("IngestQueue", queueSchema);
