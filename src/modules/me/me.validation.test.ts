import { describe, expect, test } from "bun:test";
import { HttpError } from "../../middleware/errors.ts";
import { parseProfilePut } from "./me.validation.ts";

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "no throw";
  } catch (err) {
    return err instanceof HttpError ? err.status : "wrong error type";
  }
}

const valid = {
  skills: ["react", "nodejs"],
  team_size_band: "small",
  duration: "medium",
  concurrent: 2,
  budget_min: 1_000_000,
  budget_max: 8_000_000,
  notify: { on_match: true, only_strong_fit: true, include_signals: false },
};

describe("parseProfilePut", () => {
  test("accepts the wizard's full profile", () => {
    expect(parseProfilePut(valid)).toEqual(valid as never);
  });

  test("a full replace: every field is required", () => {
    for (const key of Object.keys(valid)) {
      const body: Record<string, unknown> = { ...valid };
      delete body[key];
      expect(status(() => parseProfilePut(body))).toBe(400);
    }
    expect(status(() => parseProfilePut({ ...valid, notify: { on_match: true } }))).toBe(400);
  });

  test("budget_max null means no maximum", () => {
    expect(parseProfilePut({ ...valid, budget_max: null }).budget_max).toBeNull();
  });

  test("rejects a budget range that excludes everything", () => {
    expect(status(() => parseProfilePut({ ...valid, budget_min: 9, budget_max: 1 }))).toBe(400);
  });

  test("enums are enforced", () => {
    expect(status(() => parseProfilePut({ ...valid, team_size_band: "huge" }))).toBe(400);
    expect(status(() => parseProfilePut({ ...valid, duration: "forever" }))).toBe(400);
  });

  test("concurrent is a whole number of at least 1", () => {
    expect(status(() => parseProfilePut({ ...valid, concurrent: 0 }))).toBe(400);
    expect(status(() => parseProfilePut({ ...valid, concurrent: 1.5 }))).toBe(400);
  });

  test("skills are ids, deduplicated, and bounded", () => {
    expect(parseProfilePut({ ...valid, skills: ["react", "react"] }).skills).toEqual(["react"]);
    expect(status(() => parseProfilePut({ ...valid, skills: "react" }))).toBe(400);
    expect(status(() => parseProfilePut({ ...valid, skills: [{ $ne: null }] }))).toBe(400);
    expect(status(() => parseProfilePut({ ...valid, skills: Array(51).fill("x").map((x, i) => x + i) }))).toBe(400);
  });

  test("keys it does not name are dropped — role cannot ride along", () => {
    const parsed = parseProfilePut({ ...valid, role: "admin", user_id: "someone" });
    expect("role" in parsed).toBe(false);
    expect("user_id" in parsed).toBe(false);
  });
});
