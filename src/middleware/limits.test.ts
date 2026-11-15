import { describe, expect, test } from "bun:test";
import type { Request, RequestHandler, Response } from "express";
import { env } from "../config/env.ts";
import { HttpError } from "./errors.ts";
import {
  pipelineLimit,
  profileLimit,
  readLimit,
  runLimit,
  writeLimit,
} from "./limits.ts";
import { resetRateLimits } from "./rateLimit.ts";

const tiers: { name: string; limiter: RequestHandler; max: number }[] = [
  { name: "read", limiter: readLimit, max: env.rateLimitReadMax },
  { name: "pipeline", limiter: pipelineLimit, max: env.rateLimitPipelineMax },
  { name: "write", limiter: writeLimit, max: env.rateLimitWriteMax },
  { name: "run", limiter: runLimit, max: env.rateLimitRunMax },
  { name: "profile", limiter: profileLimit, max: env.rateLimitProfileMax },
];

function invoke(limiter: RequestHandler): unknown {
  let nextError: unknown;
  const req = {
    headers: { "x-forwarded-for": "192.0.2.1" },
    socket: { remoteAddress: "192.0.2.1" },
  } as unknown as Request;
  const res = {
    locals: { userId: "test-user" },
    setHeader() {
      return this;
    },
  } as unknown as Response;

  limiter(req, res, (error?: unknown) => {
    nextError = error;
  });
  return nextError;
}

describe("inbound rate-limit tiers", () => {
  // Verify each configured tier allows its full budget, then rejects one extra request.
  for (const { name, limiter, max } of tiers) {
    test(`${name} tier allows ${max} requests and rejects the next`, () => {
      resetRateLimits();

      for (let request = 0; request < max; request += 1) {
        expect(invoke(limiter)).toBeUndefined();
      }

      const error = invoke(limiter);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toMatchObject({ status: 429 });
    });
  }
});
