import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { requestLog } from "./requestLog.ts";

describe("requestLog", () => {
  test("does not include query strings containing personal data or credentials", () => {
    let finishHandler: (() => void) | undefined;
    const request = {
      method: "GET",
      path: "/api/search",
      originalUrl:
        "/api/search?email=person@example.com&api_key=secret-value",
    } as unknown as Request;
    const response = {
      statusCode: 200,
      on: (_event: string, handler: () => void) => {
        finishHandler = handler;
      },
    } as unknown as Response;
    const originalLog = console.log;
    let logLine = "";

    console.log = (...args: unknown[]) => {
      logLine = args.join(" ");
    };

    try {
      requestLog(request, response, () => {});
      finishHandler?.();
    } finally {
      console.log = originalLog;
    }

    expect(logLine).toContain("GET /api/search 200");
    expect(logLine).not.toContain("person@example.com");
    expect(logLine).not.toContain("secret-value");
    expect(logLine).not.toContain("?");
  });
});
