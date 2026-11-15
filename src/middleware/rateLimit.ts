import type { Request, RequestHandler, Response } from "express";
import { HttpError } from "./errors.ts";
import { RateLimitModel } from "./rateLimit.model.ts";

/**
 * A fixed-window counter per client, held in a shared Mongo collection (Sec
 * P11 / T19) so the limit holds across a restart and across more than one
 * backend instance.
 *
 * Previously an in-memory Map — hand-rolled rather than Redis to keep the
 * runtime dependency list short (AGENTS.md), which is also why this moved to
 * Mongo rather than Redis: no new service, no new dependency, same
 * reasoning the project already used for its queue (ingestion hands off
 * through Mongo rows, not a broker). The trade is one DB round trip per
 * checked request instead of a map lookup — acceptable for this traffic.
 */

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  /** Distinguishes buckets so two limiters never share a counter for one IP. */
  name: string;
  /**
   * Who a request counts against. Defaults to the client IP. Routes called only
   * by the frontend's server all share that server's IP, so they key by user.
   */
  key?: (req: Request, res: Response) => string;
};

// How long a bucket survives past its window before the TTL index reaps it.
// Generous on purpose: this is cleanup, not the reset signal — see
// rateLimit.model.ts. Must exceed the longest windowMs any limiter uses
// (today, runLimit's one hour) or a still-relevant bucket could be swept.
const SWEEP_GRACE_MS = 2 * 60 * 60_000;

/**
 * Behind Caddy every connection arrives from the proxy, so `remoteAddress` is
 * the same value for everyone. The leftmost X-Forwarded-For entry is the
 * original client — forwarded here by the frontend's BFF (src/api/client.ts
 * request()), which is itself behind the same Caddy and reads this header
 * from ITS OWN incoming request. Before that existed, every browser request
 * arrived looking like it came from the frontend's one process (Sec P11).
 *
 * That header is client-controlled and trivially spoofed, so this is only safe
 * because the backend port is not published to the host — nothing reaches it
 * except through the proxy (or the BFF, which is itself only reachable
 * through the proxy). If 8003 is ever exposed again, this becomes a bypass.
 */
function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

export function rateLimit({
  windowMs,
  max,
  name,
  key: keyOf = clientKey,
}: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const now = Date.now();
    const nowDate = new Date(now);
    const key = `${name}:${keyOf(req, res)}`;

    // One atomic pipeline update: the database itself decides whether this
    // request starts a new window or extends the current one, so two
    // processes hitting the same key at the same instant can't both "win" a
    // reset the way a separate read-then-write would.
    const windowExpired = {
      $or: [{ $eq: ["$resetAt", null] }, { $lte: ["$resetAt", nowDate] }],
    };
    const bucket = await RateLimitModel.findOneAndUpdate(
      { _id: key },
      [
        {
          $set: {
            count: { $cond: [windowExpired, 1, { $add: [{ $ifNull: ["$count", 0] }, 1] }] },
            resetAt: { $cond: [windowExpired, new Date(now + windowMs), "$resetAt"] },
            expiresAt: {
              $cond: [windowExpired, new Date(now + windowMs + SWEEP_GRACE_MS), "$expiresAt"],
            },
          },
        },
      ],
      { upsert: true, returnDocument: "after", updatePipeline: true },
    )
      .lean<{ count: number; resetAt: Date }>()
      .exec();

    const resetSeconds = Math.ceil((bucket.resetAt.getTime() - now) / 1000);
    const remaining = Math.max(0, max - bucket.count);

    // draft-7 names, so a client can back off without parsing the error body.
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(resetSeconds));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(resetSeconds));
      next(
        new HttpError(
          429,
          `Too many requests. Try again in ${resetSeconds}s.`,
        ),
      );
      return;
    }

    next();
  };
}

/** Test seam — the shared collection would otherwise leak between cases. */
export async function resetRateLimits(): Promise<void> {
  await RateLimitModel.deleteMany({});
}
