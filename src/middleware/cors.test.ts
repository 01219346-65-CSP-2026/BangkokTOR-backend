import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { env } from "../config/env.ts";

import { cors } from "./cors.ts";

const originalCorsOrigins = env.corsOrigins;
beforeAll(() => {
  Object.defineProperty(env, "corsOrigins", { value: ["https://allowed.example"] });
});
afterAll(() => {
  Object.defineProperty(env, "corsOrigins", { value: originalCorsOrigins });
});

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
