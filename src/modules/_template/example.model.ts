import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

/**
 * The MODEL layer owns the shape of the data and the rules that must hold no
 * matter who is writing — HTTP, a script, a seeder, a future queue worker.
 * It knows nothing about `req` or `res`.
 */
const exampleSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },

    // `unique` is not a validator — it builds a unique index. A racing duplicate
    // surfaces as a driver error (code 11000), which the service maps to 409.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },

    description: { type: String, default: "", maxlength: 2000 },
    priceTHB: { type: Number, required: true, min: 0 },
    tags: { type: [String], default: [] },
    isPublished: { type: Boolean, default: false },
  },
  {
    timestamps: true, // adds createdAt / updatedAt, maintained by mongoose
    versionKey: false, // drops __v so serialized output stays clean
  },
);

// Indexes belong next to the schema, not scattered through query code.
// Rule of thumb: every field you filter or sort on in a hot path needs one.
exampleSchema.index({ isPublished: 1, createdAt: -1 });
exampleSchema.index({ tags: 1 });
exampleSchema.index({ name: "text", description: "text" });

/** Inferred from the schema — one source of truth, no hand-written interface to drift. */
export type Example = InferSchemaType<typeof exampleSchema>;

/** A live mongoose document (has .save(), .populate(), etc). */
export type ExampleDoc = HydratedDocument<Example>;

/** What `.lean()` hands back: the raw stored fields plus _id. */
export type ExampleLean = Example & { _id: Types.ObjectId };

export const ExampleModel = model<Example>("Example", exampleSchema);
