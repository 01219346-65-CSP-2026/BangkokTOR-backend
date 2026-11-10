import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/**
 * Backs rateLimit.ts's shared counters (Sec P11 / T19) — replaces the old
 * in-memory Map so a limit holds across a restart and across more than one
 * backend instance.
 *
 * TTL-indexed on `expiresAt` so a bucket nobody touches again is eventually
 * swept, the same role the old in-memory sweeper played — but Mongo's TTL
 * pass runs on its own ~60s cadence, not instantly, so this is cleanup only.
 * `resetAt`, checked in rateLimit.ts's own update, is what decides
 * correctness; `expiresAt` just bounds how long a stale row lingers.
 */

const rateLimitSchema = new Schema(
  {
    // "<limiter name>:<client key>" — one row per bucket.
    _id: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    resetAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false, collection: "rate_limits" },
);

rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RateLimitBucket = InferSchemaType<typeof rateLimitSchema>;
export type RateLimitBucketDoc = HydratedDocument<RateLimitBucket>;

export const RateLimitModel = model("RateLimit", rateLimitSchema);
