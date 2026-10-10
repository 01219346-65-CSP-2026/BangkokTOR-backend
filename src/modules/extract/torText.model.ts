import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";


const torTextSchema = new Schema(
  {
    torId: { type: Schema.Types.ObjectId, ref: "Tor", required: true },
    projectId: { type: String, required: true },
    documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },

    fullText: { type: String, required: true },
    chars: { type: Number, required: true },
    truncated: { type: Boolean, default: false },
    files: { type: [
        {
            _id: false,
            filename: { type: String, required: true},
            pages: { type: Number, required: true},
            start: { type: Number, required: true},
            end: { type: Number, required: true},
        }
    ], default: [] }, 
  },
  { timestamps: true, versionKey: false, collection: "tor_texts" },
);

torTextSchema.index({ torId: 1 }, {unique: true});

export type TorText = InferSchemaType<typeof torTextSchema>;
export type TorTextDoc = HydratedDocument<TorText>;
export type TorTextLean = TorText & { _id: Types.ObjectId };

export const TorTextModel = model<TorText>("TorText", torTextSchema);