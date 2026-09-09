import { Schema, model, Document, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';


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

export const NotificationModel = model('Notification', notificationSchema);