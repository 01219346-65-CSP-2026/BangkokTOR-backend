import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";

const originalCorsOrigins = process.env.CORS_ORIGINS;
const originalNodeEnv = process.env.NODE_ENV;
process.env.CORS_ORIGINS = "https://allowed.example";
process.env.NODE_ENV = "production";

const { cors } = await import("./cors.ts");

if (originalCorsOrigins === undefined) {
  delete process.env.CORS_ORIGINS;
} else {
  process.env.CORS_ORIGINS = originalCorsOrigins;
}
if (originalNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnv;
}

function invoke(origin: string, path: string): Record<string, string> {
  const headers: Record<string, string> = {};
  const req = {
    method: "GET",
    path,
    headers: { origin },
  } as unknown as Request;
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
  } as unknown as Response;

  cors(req, res, () => {});
  return headers;
}

describe("cors", () => {
  test("allows an origin from CORS_ORIGINS", () => {
    expect(invoke("https://allowed.example", "/api/data")["Access-Control-Allow-Origin"]).toBe(
      "https://allowed.example",
    );
  });

  test("does not allow origins outside CORS_ORIGINS", () => {
    expect(invoke("https://other.example", "/api/data")).not.toHaveProperty(
      "Access-Control-Allow-Origin",
    );
  });

  test("allows a Chrome extension origin on the capture route", () => {
    expect(
      invoke("chrome-extension://test-extension-id", "/api/ingest/capture")[
        "Access-Control-Allow-Origin"
      ],
    ).toBe("chrome-extension://test-extension-id");
  });

  test("does not allow a Chrome extension origin on other routes", () => {
    expect(
      invoke("chrome-extension://test-extension-id", "/api/ingest/run"),
    ).not.toHaveProperty("Access-Control-Allow-Origin");
  });
});
