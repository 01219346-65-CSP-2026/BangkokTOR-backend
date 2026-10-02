import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

// Per-source resume state (§4.3). Exists because neither portal supports
// incremental queries — "what's new" is our state, not theirs.

const watermarkSchema = new Schema(
  {
    sourceId: { type: String, required: true, unique: true },
    // Which feed wrote this (ingest.service.ts runDiscovery). A cursor from one
    // feed means nothing to the other.
    feed: { type: String, enum: ["ckan", "govspending", "bma", null], default: null },
    // govspending: the bulk file's published version, and where in it the scan
    // stopped — a CSV entry name and data rows read from it.
    bulkUrl: { type: String, default: null },
    bulkBytes: { type: Number, default: null },
    bulkLastModified: { type: String, default: null },
    // "<bytes>|<last-modified>" of the last file read to the end. Equal to the
    // server's current version → nothing new to read.
    bulkCompletedVersion: { type: String, default: null },
    entry: { type: String, default: null },
    row: { type: Number, default: 0 },
    // CKAN: an offset within resourceId, for fiscalYear.
    fiscalYear: { type: Number, default: null },
    resourceId: { type: String, default: null },
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
