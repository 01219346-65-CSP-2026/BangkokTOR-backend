import { Schema, model, Types, type InferSchemaType, type HydratedDocument } from 'mongoose';

/**
 * A technology a team can claim experience in — "React", ".NET", "PostgreSQL".
 * The vocabulary that user profiles reference and that TOR matching scores
 * against.
 *
 * ⚠ This file used to be a verbatim copy of notification.model.ts: the
 * collection was declared with user_id / title / message / is_read / matched_at,
 * which is a notification, not a tech stack. Two things were broken by it —
 * `POST /api/techstack` demanded a user_id and a title and would not accept a
 * name, and the model registered as 'Techstack' while user.model.ts populates
 * `tech_stack_id` against ref 'TechStack', so that relationship could never
 * resolve. The model name below is the one the ref expects.
 */
const techstackSchema = new Schema({
  // Unique because the point of this collection is one row per technology.
  // A duplicate is a 409 from the service, not a second row.
  name: { type: String, required: true, unique: true, trim: true },

  // Optional grouping, matching how the frontend's skills wizard lays the
  // vocabulary out — see BangkokTOR-frontend/src/lib/skillProfile.ts.
  category: { type: String, default: null },

  created_at: { type: Date, default: Date.now },
});

export type Techstack = InferSchemaType<typeof techstackSchema>;
export type TechstackDoc = HydratedDocument<Techstack>;
export type TechstackLean = Techstack & { _id: Types.ObjectId };

export type CreateTechstackInput = Omit<Techstack, "_id" | "__v" | "created_at">;
export type UpdateTechstackInput = Partial<CreateTechstackInput>;

export type TechstackJSON = Omit<Techstack, "__v" | "created_at"> & { id: string };

// `name` already has a unique index from the field definition, which serves
// both the uniqueness check and the anchored prefix search.
techstackSchema.index({ category: 1, name: 1 });

// 'TechStack', not 'Techstack' — user.model.ts refs this exact string.
export const TechstackModel = model('TechStack', techstackSchema);
