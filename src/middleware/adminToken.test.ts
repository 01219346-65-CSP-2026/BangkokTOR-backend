import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";

const originalAdminToken = process.env.ADMIN_TOKEN;
const originalCaptureToken = process.env.CAPTURE_TOKEN;
process.env.ADMIN_TOKEN = "admin-token-test";
process.env.CAPTURE_TOKEN = "capture-token-test";

const [{ requireAdminToken }, { HttpError }] = await Promise.all([
  import("./adminToken.ts"),
  import("./errors.ts"),
]);

if (originalAdminToken === undefined) {
  delete process.env.ADMIN_TOKEN;
} else {
  process.env.ADMIN_TOKEN = originalAdminToken;
}
if (originalCaptureToken === undefined) {
  delete process.env.CAPTURE_TOKEN;
} else {
  process.env.CAPTURE_TOKEN = originalCaptureToken;
}

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
