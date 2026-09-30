import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { HttpError } from "../../middleware/errors.ts";
import { verifyHs256 } from "./jwt.ts";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** Signs the same way `jsonwebtoken` does for HS256. */
function sign(payload: unknown, secret = SECRET, header: unknown = { alg: "HS256", typ: "JWT" }) {
  const head = `${b64(header)}.${b64(payload)}`;
  return `${head}.${createHmac("sha256", secret).update(head).digest("base64url")}`;
}

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "no throw";
  } catch (err) {
    return err instanceof HttpError ? err.status : "wrong error type";
  }
}

const valid = { sub: "google-123", email: "a@b.co", exp: NOW / 1000 + 60 };

describe("verifyHs256", () => {
  test("accepts a token signed with the shared secret", () => {
    expect(verifyHs256(sign(valid), SECRET, NOW)).toEqual({ sub: "google-123", email: "a@b.co" });
  });

  test("rejects a token signed with another secret", () => {
    expect(status(() => verifyHs256(sign(valid, "other"), SECRET, NOW))).toBe(401);
  });

  test("rejects a tampered payload", () => {
    const [h, , s] = sign(valid).split(".");
    const forged = `${h}.${b64({ ...valid, sub: "someone-else" })}.${s}`;
    expect(status(() => verifyHs256(forged, SECRET, NOW))).toBe(401);
  });

  test("rejects an expired token, and one with no exp", () => {
    expect(status(() => verifyHs256(sign({ ...valid, exp: NOW / 1000 - 60 }), SECRET, NOW))).toBe(401);
    expect(status(() => verifyHs256(sign({ sub: "x" }), SECRET, NOW))).toBe(401);
  });

  test("rejects alg none and any alg other than HS256", () => {
    const none = `${b64({ alg: "none" })}.${b64(valid)}.`;
    expect(status(() => verifyHs256(none, SECRET, NOW))).toBe(401);
    expect(status(() => verifyHs256(sign(valid, SECRET, { alg: "HS512" }), SECRET, NOW))).toBe(401);
  });

  test("rejects malformed input and an empty secret", () => {
    expect(status(() => verifyHs256("not.a.jwt", SECRET, NOW))).toBe(401);
    expect(status(() => verifyHs256("abc", SECRET, NOW))).toBe(401);
    expect(status(() => verifyHs256(sign(valid), "", NOW))).toBe(401);
  });

  test("requires a subject", () => {
    expect(status(() => verifyHs256(sign({ exp: valid.exp }), SECRET, NOW))).toBe(401);
  });
});
