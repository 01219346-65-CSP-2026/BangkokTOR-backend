import { Schema, model, type InferSchemaType, type Types } from "mongoose";

// A TOR a signed-in reader saved to follow (the detail page's "บันทึกไว้ติดตาม",
// listed on /profile). Its own collection rather than an array on the user:
// "is this TOR saved?" is then one indexed lookup, and a long list never
// bloats the user document every profile read has to load.

const bookmarkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    torId: { type: Schema.Types.ObjectId, ref: "Tor", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: "bookmarks" },
);

// Saving twice is one bookmark, not two.
bookmarkSchema.index({ userId: 1, torId: 1 }, { unique: true });
// The profile page lists newest first.
bookmarkSchema.index({ userId: 1, createdAt: -1 });

export type Bookmark = InferSchemaType<typeof bookmarkSchema>;
export type BookmarkLean = Bookmark & { _id: Types.ObjectId; createdAt: Date };

export const BookmarkModel = model<Bookmark>("Bookmark", bookmarkSchema);
