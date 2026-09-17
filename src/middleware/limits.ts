import { env } from "../config/env.ts";
import { rateLimit } from "./rateLimit.ts";

/**
 * The application's rate-limit tiers, defined once.
 *
 * They live here rather than in routes/index.ts because the run modules need
 * two different tiers on two routes of the same router — a router-level mount
 * would have capped status polling at the run budget.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Public browsing. Set well above what a person clicking through can reach. */
export const readLimit = rateLimit({
  name: "read",
  windowMs: MINUTE,
  max: env.rateLimitReadMax,
});

/** Pipeline and run status, polled by the admin UI. */
export const pipelineLimit = rateLimit({
  name: "pipeline",
  windowMs: MINUTE,
  max: env.rateLimitPipelineMax,
});

/** CRUD on user/notification/techstack. */
export const writeLimit = rateLimit({
  name: "write",
  windowMs: MINUTE,
  max: env.rateLimitWriteMax,
});

/**
 * Starting pipeline work. Each run costs minutes of GPU or polite-fetch time,
 * so the budget is only enough to retry a failed run by hand.
 */
export const runLimit = rateLimit({
  name: "run",
  windowMs: HOUR,
  max: env.rateLimitRunMax,
});
