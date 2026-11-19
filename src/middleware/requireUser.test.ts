import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.ts";
import { HttpError } from "./errors.ts";
import { requireUser } from "./requireUser.ts";
import { UserModel } from "../modules/user/user.model.ts";

// CI has no .env, and env is read from process.env once, by whichever module
// imports it first, so a process.env default set here would come too late.
// Pin a test secret on env itself for this file, and put the real one back after.
const testEnv = env as { -readonly [K in keyof typeof env]: (typeof env)[K] };
const originalSecret = env.internalJwtSecret;
const SECRET = "requireUser-test-secret";
testEnv.internalJwtSecret = SECRET;
afterAll(() => {
  testEnv.internalJwtSecret = originalSecret;
});

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sign(
  payload: unknown,
  header: unknown = { alg: "HS256", typ: "JWT" },
): string {
  const head = `${b64(header)}.${b64(payload)}`;
  const signature = createHmac("sha256", SECRET).update(head).digest("base64url");
  return `${head}.${signature}`;
}

function request(authorization?: string): Request {
  return { headers: authorization ? { authorization } : {} } as Request;
}

async function expectUnauthorized(req: Request): Promise<void> {
  const res = { locals: {} } as Response;
  const next = () => {
    throw new Error("next should not be called for a rejected token");
  };
  const result = Promise.resolve().then(() => requireUser(req, res, next));

  await expect(result).rejects.toBeInstanceOf(HttpError);
  await expect(result).rejects.toMatchObject({ status: 401 });
}

describe("requireUser", () => {
  test("accepts a valid token for a known user", async () => {
    const user = { _id: { toString: () => "user-id" }, role: "admin" };
    const findOne = spyOn(UserModel, "findOne").mockImplementation(
      () => ({ lean: () => ({ exec: async () => user }) }) as never,
    );
    // iss/aud are pinned by verifyHs256 (shared/utils/jwt.ts), as the frontend signs them.
    const token = sign({
      sub: "google-123",
      iss: "bangkoktor-frontend",
      aud: "bangkoktor-backend",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const req = request(`Bearer ${token}`);
    const res = { locals: {} } as Response;
    const nextCalls: unknown[] = [];

    try {
      await requireUser(req, res, (error?: unknown) => nextCalls.push(error));

      expect(findOne).toHaveBeenCalledWith(
        { google_id: "google-123" },
        { _id: 1, role: 1 },
      );
      expect(res.locals).toMatchObject({ userId: "user-id", role: "admin" });
      expect(nextCalls).toEqual([undefined]);
    } finally {
      findOne.mockRestore();
    }
  });

  test("rejects a missing token", async () => {
    await expectUnauthorized(request());
  });

  test("rejects an expired token", async () => {
    const token = sign({ sub: "google-123", exp: Math.floor(Date.now() / 1000) - 60 });
    await expectUnauthorized(request(`Bearer ${token}`));
  });

  test("rejects a token with the wrong algorithm", async () => {
    const token = sign(
      { sub: "google-123", exp: Math.floor(Date.now() / 1000) + 60 },
      { alg: "HS512", typ: "JWT" },
    );
    await expectUnauthorized(request(`Bearer ${token}`));
  });

  test("rejects an anonymous token", async () => {
    const token = sign({ sub: "anonymous", exp: Math.floor(Date.now() / 1000) + 60 });
    await expectUnauthorized(request(`Bearer ${token}`));
  });
});
