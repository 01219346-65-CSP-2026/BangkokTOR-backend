import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

// Per-source resume state (§4.3). Exists because neither portal supports
// incremental queries — "what's new" is our state, not theirs.

const watermarkSchema = new Schema(
  {
    sourceId: { type: String, required: true, unique: true },
    lastOffset: { type: Number, default: 0 },
    lastSeenProjectId: { type: String, default: null },
    lastFullScanAt: { type: Date, default: null },
    totalRows: { type: Number, default: null },
  },
  { timestamps: true, versionKey: false, collection: "watermarks" },
);

export type Watermark = InferSchemaType<typeof watermarkSchema>;
export type WatermarkDoc = HydratedDocument<Watermark>;

export const WatermarkModel = model<Watermark>("Watermark", watermarkSchema);
