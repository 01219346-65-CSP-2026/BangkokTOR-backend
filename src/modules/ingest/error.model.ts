import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

// Every failure, typed and attributable (§4.3). Never a swallowed catch.
// "no-bundle" does NOT belong here — it is the expected majority outcome and
// would drown the admin panel in noise about projects that are perfectly fine.

const errorSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: "IngestRun", default: null },
    sourceId: { type: String, required: true },
    projectId: { type: String, default: null },

    kind: { type: String, required: true },
    message: { type: String, default: "" },
    status: { type: Number, default: null },
    url: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "ingest_errors" },
);

errorSchema.index({ runId: 1 });
errorSchema.index({ sourceId: 1, kind: 1 });
errorSchema.index({ createdAt: -1 });

export type IngestError = InferSchemaType<typeof errorSchema>;
export type IngestErrorDoc = HydratedDocument<IngestError>;

export const ErrorModel = model<IngestError>("IngestError", errorSchema);
