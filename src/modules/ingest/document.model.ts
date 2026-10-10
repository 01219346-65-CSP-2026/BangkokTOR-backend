import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

// One stored file per row (§4.3). For Source B that is a zip bundle; the
// extraction stage then adds one `extractedPdf` row per PDF it expanded from
// that bundle, pointing back at it through `parentDocumentId`.

export const DOCUMENT_KINDS = ["announcement", "tor", "bundle", "extractedPdf"] as const;
export const TEXT_LAYERS = ["digital", "scanned", "unreadable", "missing"] as const;

const documentSchema = new Schema(
  {
    torId: { type: Schema.Types.ObjectId, ref: "Tor", required: true },
    sourceId: { type: String, required: true },
    projectId: { type: String, required: true },

    kind: { type: String, enum: DOCUMENT_KINDS, required: true },
    url: { type: String, required: true },
    externalId: { type: String, default: null },
    filename: { type: String, default: null },

    sha256: { type: String, default: null },
    bytes: { type: Number, default: null },
    localPath: { type: String, default: null },
    pages: { type: Number, default: null },
    parentDocumentId: { type: Schema.Types.ObjectId, ref: "Document", default: null },

    // Set by triage (§4.1 stage ④), which routes the OCR bill. Null until then.
    textLayer: { type: String, enum: TEXT_LAYERS, default: null },

    fetchedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "documents" },
);

documentSchema.index({ torId: 1 });
documentSchema.index({ sha256: 1 });
documentSchema.index({ sourceId: 1, projectId: 1, externalId: 1 }, { unique: true });

export type IngestDocument = InferSchemaType<typeof documentSchema>;
export type IngestDocumentDoc = HydratedDocument<IngestDocument>;
export type IngestDocumentLean = IngestDocument & { _id: Types.ObjectId };

export const DocumentModel = model<IngestDocument>("Document", documentSchema);
