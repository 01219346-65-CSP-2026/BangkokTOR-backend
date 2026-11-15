import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { connectMongo, disconnectMongo } from "../db/mongo.ts";
import { HttpError } from "./errors.ts";
import { rateLimit, resetRateLimits } from "./rateLimit.ts";

// Sec P11 (T19) — the shared-store rate limiter. Needs a real Mongo
// connection: the whole point of this fix is that the counter is shared
// across processes, not held in one process's memory, and that can't be
// proven against a fake. Run with:   bun test src/middleware/rateLimit
// (needs `docker compose up -d mongo`, and MONGODB_URI in .env.test.local —
// see AGENTS.md's "Commands" section).

beforeAll(async () => {
  await connectMongo();
});

afterAll(async () => {
  await disconnectMongo();
});

beforeEach(async () => {
  await resetRateLimits();
});

function fakeReqRes(ip = "1.2.3.4") {
  const headers = new Map<string, string>();
  const req = { headers: {}, socket: { remoteAddress: ip } } as unknown as Request;
  const res = {
    setHeader: (name: string, value: string) => headers.set(name, value),
    getHeader: (name: string) => headers.get(name),
  } as unknown as Response;
  return { req, res };
}

/** Runs the middleware and resolves with whatever it passed to `next`. */
function run(handler: ReturnType<typeof rateLimit>, req: Request, res: Response): Promise<unknown> {
  return new Promise((resolve) => {
    void handler(req, res, (err?: unknown) => resolve(err));
  });
}

describe("rateLimit", () => {
  test("the first `max` requests pass; the next is a 429 with Retry-After", async () => {
    const limiter = rateLimit({ name: "t1", windowMs: 60_000, max: 2 });
    const { req, res } = fakeReqRes();

    expect(await run(limiter, req, res)).toBeUndefined();
    expect(await run(limiter, req, res)).toBeUndefined();

    const third = await run(limiter, req, res);
    expect(third).toBeInstanceOf(HttpError);
    expect((third as HttpError).status).toBe(429);
    expect(res.getHeader("Retry-After")).toBeDefined();
  });

  test("two different clients never share a bucket", async () => {
    const limiter = rateLimit({ name: "t2", windowMs: 60_000, max: 1 });
    const a = fakeReqRes("1.1.1.1");
    const b = fakeReqRes("2.2.2.2");

    expect(await run(limiter, a.req, a.res)).toBeUndefined();
    expect(await run(limiter, b.req, b.res)).toBeUndefined();
    // a's second request is over its own limit — b never touched it.
    expect(await run(limiter, a.req, a.res)).toBeInstanceOf(HttpError);
  });

  test("two different limiter names never share a bucket for the same client", async () => {
    const limitA = rateLimit({ name: "t3a", windowMs: 60_000, max: 1 });
    const limitB = rateLimit({ name: "t3b", windowMs: 60_000, max: 1 });
    const { req, res } = fakeReqRes();

    expect(await run(limitA, req, res)).toBeUndefined();
    expect(await run(limitB, req, res)).toBeUndefined();
  });

  test("the counter is shared across separate rateLimit() instances — not per-process memory", async () => {
    // Simulates a second backend process: a brand new middleware closure,
    // same name+key, drawing on the shared Mongo collection rather than its
    // own in-memory Map. This is the behaviour an in-memory Map could never
    // have passed — the actual point of this fix.
    const first = rateLimit({ name: "t4", windowMs: 60_000, max: 2 });
    const second = rateLimit({ name: "t4", windowMs: 60_000, max: 2 });
    const { req, res } = fakeReqRes();

    expect(await run(first, req, res)).toBeUndefined();
    expect(await run(second, req, res)).toBeUndefined();
    // Third request total, from either instance, is over the shared max.
    expect(await run(first, req, res)).toBeInstanceOf(HttpError);
  });

  test("a custom key function is honoured over the client IP", async () => {
    const limiter = rateLimit({ name: "t5", windowMs: 60_000, max: 1, key: () => "same-user" });
    const a = fakeReqRes("1.1.1.1");
    const b = fakeReqRes("2.2.2.2");

    expect(await run(limiter, a.req, a.res)).toBeUndefined();
    // Different IPs, same custom key — still the same bucket.
    expect(await run(limiter, b.req, b.res)).toBeInstanceOf(HttpError);
  });

  test("RateLimit-* headers are set on every response", async () => {
    const limiter = rateLimit({ name: "t6", windowMs: 60_000, max: 5 });
    const { req, res } = fakeReqRes();

    await run(limiter, req, res);

    expect(res.getHeader("RateLimit-Limit")).toBe("5");
    expect(res.getHeader("RateLimit-Remaining")).toBe("4");
  });

  test("a fresh window after resetAt passes starts the count back at 1", async () => {
    const limiter = rateLimit({ name: "t7", windowMs: 1, max: 1 });
    const { req, res } = fakeReqRes();

    expect(await run(limiter, req, res)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    // The 1ms window is long over — this should read as a brand new window,
    // not "still over the old one".
    expect(await run(limiter, req, res)).toBeUndefined();
  });
});
