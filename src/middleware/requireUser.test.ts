import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { env } from "../config/env.ts";
import { HttpError } from "./errors.ts";
import { requireUser } from "./requireUser.ts";

const SECRET = env.internalJwtSecret;
if (!SECRET) throw new Error("INTERNAL_JWT_SECRET must be set to test requireUser");

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
