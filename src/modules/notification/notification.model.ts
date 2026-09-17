import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';


const notificationSchema = new Schema({
  //links to the User 
  user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  
  //links to the Tor 
  tor_id: { type: Schema.Types.ObjectId, ref: 'Tor' },
  
  title: { type: String, required: true },
  message: String,
  matched_at: Date,
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
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

export const NotificationModel = model('Notification', notificationSchema);