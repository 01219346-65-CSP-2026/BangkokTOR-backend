import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';


/** Where a notification's email stands. See the contract block below. */
export const EMAIL_STATUSES = ["pending", "sent", "failed", "skipped"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

const notificationSchema = new Schema({
  //links to the User 
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  //links to the Tor 
  tor_id: { type: Schema.Types.ObjectId, ref: 'Tor' },
  
  title: { type: String, required: true },
  message: String,
  matched_at: Date,
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },

  // ── feat/SCRUM-75-77: THE CONTRACT between the two halves of the branch.
  // Part A (ingest → match) writes rows with fit_score and
  // email_status "pending"; Part B (email) picks up "pending" rows, sends
  // them, and moves them to "sent" / "failed" / "skipped". Neither half
  // changes these fields' meaning without telling the other.

  /** 0–100, from tor.preview.ts fitScore. Null on rows not made by matching. */
  fit_score: { type: Number, default: null },
  /** "skipped" by default: only matching asks for an email, explicitly. */
  email_status: { type: String, enum: EMAIL_STATUSES, default: "skipped" },
  emailed_at: { type: Date, default: null },
  /** Why the last send failed — for the admin, never shown to the reader. */
  email_error: { type: String, default: null },
});

export type Notification = InferSchemaType<typeof notificationSchema>;
export type NotificationDoc = HydratedDocument<Notification>;
export type NotificationLean = Notification & { _id: Types.ObjectId };

export type CreateNotificationInput = Omit<Notification, "_id" | "__v" | "created_at">;
export type UpdateNotificationInput = Partial<CreateNotificationInput>;

export type NotificationJSON = Omit<Notification, "__v" | "created_at"> & { id: string };

// "this user's notifications, newest first" is the only query this collection
// exists to answer, and it had no index at all — every request was a full
// collection scan.
notificationSchema.index({ user_id: 1, created_at: -1 });
// Unread counts for the nav badge.
notificationSchema.index({ user_id: 1, is_read: 1 });
// One notification per (user, TOR): re-running matching on the same TOR must
// never notify twice. Partial, so hand-made rows without a TOR are unaffected.
notificationSchema.index(
  { user_id: 1, tor_id: 1 },
  { unique: true, partialFilterExpression: { tor_id: { $type: "objectId" } } },
);
// The email worker's queue: oldest pending first.
notificationSchema.index({ email_status: 1, created_at: 1 });

export const NotificationModel = model('Notification', notificationSchema);