import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";

const originalAdminToken = process.env.ADMIN_TOKEN;
process.env.ADMIN_TOKEN = "admin-token-test";

const [{ requireAdminToken }, { HttpError }] = await Promise.all([
  import("./adminToken.ts"),
  import("./errors.ts"),
]);

if (originalAdminToken === undefined) {
  delete process.env.ADMIN_TOKEN;
} else {
  process.env.ADMIN_TOKEN = originalAdminToken;
}

function invoke(token: string): unknown[] {
  const calls: unknown[] = [];
  const req = {
    method: "POST",
    originalUrl: "/admin",
    headers: { "x-admin-token": token },
  } as unknown as Request;

  requireAdminToken(req, {} as Response, (error?: unknown) => calls.push(error));
  return calls;
}

describe("requireAdminToken", () => {
  test("returns a 404 for a wrong token", () => {
    const calls = invoke("wrong-token");

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(HttpError);
    expect(calls[0]).toMatchObject({ status: 404 });
  });

  test("passes when the right token is provided", () => {
    expect(invoke("admin-token-test")).toEqual([undefined]);
  });
});
