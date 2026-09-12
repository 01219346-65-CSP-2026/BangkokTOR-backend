import { describe, expect, test } from "bun:test";
import { HttpError } from "../../middleware/errors.ts";
import {
  parseCreateNotification,
  parseListNotifications,
  parseUpdateNotification,
} from "./notification.validation.ts";

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "no throw";
  } catch (err) {
    return err instanceof HttpError ? err.status : "wrong error type";
  }
}

const ID = "6aa51ee3c3f15ca4cda033df";

describe("parseCreateNotification", () => {
  test("requires a valid user_id and a title", () => {
    expect(status(() => parseCreateNotification({ title: "hi" }))).toBe(400);
    expect(status(() => parseCreateNotification({ user_id: ID }))).toBe(400);
    expect(status(() => parseCreateNotification({ user_id: "not-an-id", title: "hi" }))).toBe(400);
  });

  test("accepts a minimal valid body", () => {
    expect(parseCreateNotification({ user_id: ID, title: "New match" })).toEqual({
      user_id: ID,
      title: "New match",
    });
  });

  test("parses matched_at into a Date and rejects nonsense", () => {
    const out = parseCreateNotification({ user_id: ID, title: "x", matched_at: "2026-01-11" });
    expect(out.matched_at).toBeInstanceOf(Date);
    expect(status(() => parseCreateNotification({ user_id: ID, title: "x", matched_at: "soon" }))).toBe(400);
  });
});

describe("parseUpdateNotification", () => {
  test("cannot reassign the notification to another user", () => {
    // Not an edit — that is how a row lands in someone else's feed.
    const out = parseUpdateNotification({ is_read: true, user_id: ID }) as Record<string, unknown>;
    expect("user_id" in out).toBe(false);
  });

  test("marking read is the common case", () => {
    expect(parseUpdateNotification({ is_read: true })).toEqual({ is_read: true });
  });

  test("rejects a non-boolean is_read", () => {
    expect(status(() => parseUpdateNotification({ is_read: "yes" }))).toBe(400);
  });

  test("requires at least one field", () => {
    expect(status(() => parseUpdateNotification({}))).toBe(400);
  });
});

describe("parseListNotifications", () => {
  test("rejects a filter id that is not an ObjectId", () => {
    expect(status(() => parseListNotifications({ user_id: "abc" }))).toBe(400);
  });

  test("whitelists sort and defaults to newest first", () => {
    expect(status(() => parseListNotifications({ sort: "created_at; drop" }))).toBe(400);
    expect(parseListNotifications({}).sort).toBe("-created_at");
  });

  test("passes through the supported filters", () => {
    expect(parseListNotifications({ user_id: ID, is_read: false })).toMatchObject({
      user_id: ID,
      is_read: false,
    });
  });
});
