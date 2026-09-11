import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

// Chunks are persisted rather than recomputed. Two reasons: the grader (step 5)
// is a separate stage that must be re-runnable when a prompt or a model changes,
// and a stored evidence quote has to be checkable against the exact text the
// model was shown.

const chunkSchema = new Schema(
  {
    torId: { type: Schema.Types.ObjectId, ref: "Tor", required: true },
    projectId: { type: String, required: true },
    documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },

    /** Bundle member this came from, e.g. "doc_S31413000001_67119569806.pdf". */
    filename: { type: String, required: true },
    index: { type: Number, required: true },

    headingPath: { type: [String], default: [] },
    text: { type: String, required: true },
    chars: { type: Number, required: true },
    pageStart: { type: Number, default: 0 },
    pageEnd: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: "tor_chunks" },
);

chunkSchema.index({ torId: 1, index: 1 });
// Re-extracting a bundle overwrites its chunks instead of doubling them.
chunkSchema.index({ documentId: 1, filename: 1, index: 1 }, { unique: true });

export type TorChunk = InferSchemaType<typeof chunkSchema>;
export type TorChunkDoc = HydratedDocument<TorChunk>;
export type TorChunkLean = TorChunk & { _id: Types.ObjectId };

export const ChunkModel = model<TorChunk>("TorChunk", chunkSchema);
