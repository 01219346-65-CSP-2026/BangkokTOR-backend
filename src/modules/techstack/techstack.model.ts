import { Schema, model, Document, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';


const techstackSchema = new Schema({
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

export type Techstack = InferSchemaType<typeof techstackSchema>;
export type TechstackDoc = HydratedDocument<Techstack>;
export type TechstackLean = Techstack & { _id: Types.ObjectId };

export type CreateTechstackInput = Omit<Techstack, "_id" | "__v" | "created_at">;
export type UpdateTechstackInput = Partial<CreateTechstackInput>;

export type TechstackJSON = Omit<Techstack, "__v" | "created_at"> & { id: string };

export const TechstackModel = model('Techstack', techstackSchema);