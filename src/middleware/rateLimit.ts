import type { Request, RequestHandler } from "express";
import { HttpError } from "./errors.ts";

/**
 * A fixed-window counter per client, held in memory.
 *
 * Hand-rolled on purpose: AGENTS.md keeps the runtime dependency list at three
 * packages, and a single-process deploy does not need the coordination a Redis
 * store buys. The trade is that each process counts on its own — if this ever
 * runs more than one replica, the effective limit multiplies by the replica
 * count and this should move to a shared store.
 */

type Bucket = {
  count: number;
  /** Epoch ms at which the window resets and the count returns to zero. */
  resetAt: number;
};

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  /** Distinguishes buckets so two limiters never share a counter for one IP. */
  name: string;
};

const buckets = new Map<string, Bucket>();

// Without a sweep the map grows once per distinct IP and never shrinks. Every
// minute is frequent enough to stay small and cheap enough to ignore.
const SWEEP_MS = 60_000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
// Otherwise a test run or a SIGTERM waits on this timer before the process exits.
sweeper.unref?.();

/**
 * Behind Caddy every connection arrives from the proxy, so `remoteAddress` is
 * the same value for everyone. The leftmost X-Forwarded-For entry is the
 * original client.
 *
 * That header is client-controlled and trivially spoofed, so this is only safe
 * because the backend port is not published to the host — nothing reaches it
 * except through the proxy, which overwrites the header. If 8003 is ever
 * exposed again, this becomes a bypass.
 */
function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

export function rateLimit({ windowMs, max, name }: RateLimitOptions): RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${clientKey(req)}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);

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

/** Test seam — the module-level map would otherwise leak between cases. */
export function resetRateLimits(): void {
  buckets.clear();
}
