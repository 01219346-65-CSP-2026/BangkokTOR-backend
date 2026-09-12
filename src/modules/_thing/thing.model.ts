import { Schema, model, Document, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

// TEMPLATE
// This is a more simplified template module

const thingSchema = new Schema({
  title: { type: String, required: true, maxLength: 10},
  thing: { type: String, unique: true},
  message: String,
  matched_at: Date,
  is_read: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now }
});

export type Thing = InferSchemaType<typeof thingSchema>;
export type ThingDoc = HydratedDocument<Thing>;
export type ThingLean = Thing & { _id: Types.ObjectId };

export type CreateThingInput = Omit<Thing, "_id" | "__v" | "created_at">;
export type UpdateThingInput = Partial<CreateThingInput>;

export type ThingJSON = Omit<Thing, "__v" | "created_at"> & { id: string };

export const ThingModel = model('Thing', thingSchema);