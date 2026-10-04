import { describe, expect, test } from "bun:test";
import { pickYear, redactKey } from "./catalog.ts";

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
