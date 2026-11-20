import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Request, Response } from "express";

import { env } from "../config/env.ts";
import { requireAdminToken } from "./adminToken.ts";
import { HttpError } from "./errors.ts";

// env is a plain object, read from process.env ONCE, when the first module
// imports config/env.ts. In a full `bun test` run that is some earlier test
// file, so setting process.env here (as this file used to) changed nothing and
// the tests saw the real .env token, or none at all in CI. Set the values on
// env itself, for exactly the span of this file.
// env is typed readonly for application code; only this test writes to it.
const testEnv = env as { -readonly [K in keyof typeof env]: (typeof env)[K] };
const original = { adminToken: env.adminToken, captureToken: env.captureToken };

beforeAll(() => {
  testEnv.adminToken = "admin-token-test";
  testEnv.captureToken = "capture-token-test";
});

afterAll(() => {
  testEnv.adminToken = original.adminToken;
  testEnv.captureToken = original.captureToken;
});

function invoke(
  token: string,
  route: { method: string; baseUrl: string; path: string } = {
    method: "POST",
    baseUrl: "/admin",
    path: "/",
  },
): unknown[] {
  const calls: unknown[] = [];
  const req = {
    method: route.method,
    originalUrl: "/admin",
    baseUrl: route.baseUrl,
    path: route.path,
    headers: { "x-admin-token": token },
  } as unknown as Request;

  // The middleware records which credential passed (res.locals.tokenIdentity)
  // for the audit log, so the response needs a locals bag.
  requireAdminToken(req, { locals: {} } as unknown as Response, (error?: unknown) =>
    calls.push(error),
  );
  return calls;
}

describe("requireAdminToken", () => {
  test("returns a 404 for a wrong token", () => {
    const calls = invoke("wrong-token");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HttpError);
    expect(calls[0]).toMatchObject({ status: 404 });
  });

  test("returns a 404 for a wrong token with the same byte length", () => {
    const calls = invoke("admin-token-tesy");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HttpError);
    expect(calls[0]).toMatchObject({ status: 404 });
  });

  test("returns a 404 for a token with a different UTF-8 byte length", () => {
    const calls = invoke("admin-token-testé");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HttpError);
    expect(calls[0]).toMatchObject({ status: 404 });
  });

  test("passes when the right token is provided", () => {
    expect(invoke("admin-token-test")).toEqual([undefined]);
  });

  test("accepts the capture token on the capture endpoint", () => {
    expect(
      invoke("capture-token-test", {
        method: "POST",
        baseUrl: "/api/ingest",
        path: "/capture",
      }),
    ).toEqual([undefined]);
  });

  test("rejects the capture token on user CRUD and pipeline routes", () => {
    for (const route of [
      { method: "POST", baseUrl: "/api/user", path: "/" },
      { method: "POST", baseUrl: "/api/ingest", path: "/run" },
    ]) {
      const calls = invoke("capture-token-test", route);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toBeInstanceOf(HttpError);
      expect(calls[0]).toMatchObject({ status: 404 });
    }
  });

  test("rejects the capture token on non-POST capture requests", () => {
    const calls = invoke("capture-token-test", {
      method: "GET",
      baseUrl: "/api/ingest",
      path: "/capture",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HttpError);
    expect(calls[0]).toMatchObject({ status: 404 });
  });
});
