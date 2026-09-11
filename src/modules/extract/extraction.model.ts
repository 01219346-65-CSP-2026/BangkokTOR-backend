import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

// The second work queue. Deliberately the same shape as ingest_queue so
// claim.ts drives both unchanged — it takes Model<any> precisely for this.

export const EXTRACTION_STATUSES = ["pending", "working", "done", "failed"] as const;

const extractionQueueSchema = new Schema(
  {
    sourceId: { type: String, required: true },
    projectId: { type: String, required: true },
    torId: { type: Schema.Types.ObjectId, ref: "Tor", required: true },
    documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },

    /** The downloaded bundle this row expands. */
    localPath: { type: String, required: true },

    status: { type: String, enum: EXTRACTION_STATUSES, default: "pending", required: true },
    claimedBy: { type: String, default: null },
    claimedAt: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    reason: { type: String, default: null },

    // Filled in on success, so the admin panel can see what a bundle yielded
    // without re-reading the disk.
    pdfCount: { type: Number, default: null },
    digitalCount: { type: Number, default: null },
    scannedCount: { type: Number, default: null },
    chunkCount: { type: Number, default: null },
    extractedDir: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "extraction_queue" },
);

// One row per bundle; re-running extraction must not duplicate work.
extractionQueueSchema.index({ documentId: 1 }, { unique: true });
// The index claimNext's $or needs (see queue.model.ts).
extractionQueueSchema.index({ status: 1, claimedAt: 1 });

export type ExtractionRow = InferSchemaType<typeof extractionQueueSchema>;
export type ExtractionDoc = HydratedDocument<ExtractionRow>;
export type ExtractionLean = ExtractionRow & { _id: Types.ObjectId };

export const ExtractionQueueModel = model<ExtractionRow>(
  "ExtractionQueue",
  extractionQueueSchema,
);
