import { Schema, model, Document, Types } from 'mongoose';

export interface INotification extends Document {
  user_id: Types.ObjectId;      // links to User
  tor_id?: Types.ObjectId;      // links to Tor (not sure if we need this)
  title: string;
  message?: string;
  matched_at?: Date;
  is_read: boolean;
  created_at: Date;
}

const notificationSchema = new Schema<INotification>({
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

export const Notification = model<INotification>('Notification', notificationSchema);