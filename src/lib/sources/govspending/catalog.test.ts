import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { env } from "../../../config/env.ts";
import { pickYear, redactKey, resolveBulk } from "./catalog.ts";

const realFetch = globalThis.fetch;
const settings = env as unknown as Record<string, unknown>;
const originalDatagothKey = env.datagothKey;
const originalHttpDelayMs = env.httpDelayMs;

beforeEach(() => {
  settings.datagothKey = "test-govspending-key";
  settings.httpDelayMs = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  settings.datagothKey = originalDatagothKey;
  settings.httpDelayMs = originalHttpDelayMs;
});

describe("pickYear", () => {
  const years = [2569, 2568, 2567];

  test("the newest year when nothing is pinned", () => {
    expect(pickYear(years)).toBe(2569);
  });

  test("a pinned year that is on offer", () => {
    expect(pickYear(years, 2568)).toBe(2568);
  });

  test("null for a pinned year that is not, or nothing on offer", () => {
    expect(pickYear(years, 2570)).toBeNull();
    expect(pickYear([])).toBeNull();
  });
});

describe("resolveBulk", () => {
  test("sends the API key in a header, not in request URLs", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const data = calls.length === 1 ? [2569] : "https://example.test/2569-egp-contract.zip";
      return new Response(JSON.stringify({ success: true, data }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(resolveBulk(2569)).resolves.toEqual({
      fiscalYear: 2569,
      url: "https://example.test/2569-egp-contract.zip",
    });

    expect(calls).toHaveLength(2);
    for (const { url, init } of calls) {
      expect(url).not.toContain("test-govspending-key");
      expect(new URL(url).searchParams.has("user_key")).toBe(false);
      expect((init.headers as Record<string, string>)["api-key"]).toBe("test-govspending-key");
    }
  });
});

describe("redactKey", () => {
  test("the API key never survives into an error message", () => {
    const msg = "HTTP 500 for https://api-govspending.data.go.th/api/get/api/bulkfile?user_key=SECRETKEY123&year=2569";
    expect(redactKey(msg, "SECRETKEY123")).not.toContain("SECRETKEY123");
    expect(redactKey(msg, "SECRETKEY123")).toContain("user_key=***");
  });

  test("an empty key changes nothing", () => {
    expect(redactKey("abc", "")).toBe("abc");
  });
});
