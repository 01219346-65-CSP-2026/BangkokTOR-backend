import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

// One row per ingestion pass. This is the admin panel's data (FR-07).

export const RUN_STATUSES = ["running", "finished", "failed"] as const;

const runSchema = new Schema(
  {
    sourceId: { type: String, required: true },
    kind: { type: String, enum: ["discover", "fetch"], required: true },
    status: { type: String, enum: RUN_STATUSES, default: "running", required: true },

    startedAt: { type: Date, default: Date.now },
    finishedAt: { type: Date, default: null },

    counts: {
      scanned: { type: Number, default: 0 },
      enqueued: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },

    error: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "ingest_runs" },
);

runSchema.index({ sourceId: 1, startedAt: -1 });

export type IngestRun = InferSchemaType<typeof runSchema>;
export type IngestRunDoc = HydratedDocument<IngestRun>;
export type IngestRunLean = IngestRun & { _id: Types.ObjectId };

export const RunModel = model<IngestRun>("IngestRun", runSchema);
