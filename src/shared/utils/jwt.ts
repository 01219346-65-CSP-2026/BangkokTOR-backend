import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "../../middleware/errors.ts";

/**
 * Verifies the HS256 token the frontend's server signs for every user-scoped
 * call (BangkokTOR-frontend/src/api/client.ts, `internalToken`).
 *
 * Hand-rolled on `node:crypto` to keep the dependency list at three packages
 * (AGENTS.md). It accepts exactly one shape — HS256, with `sub` and `exp` —
 * and rejects everything else, which is most of what a JWT library's options
 * exist to get wrong:
 *
 * - `alg` is pinned. Trusting the header's `alg` is how `alg: "none"` and
 *   RS256/HS256 confusion attacks work.
 * - The signature is compared in constant time.
 * - `exp` is required, not optional. The frontend's tokens live 60 seconds.
 */

export type InternalClaims = {
  sub: string;
  email?: string;
};

/** Seconds of clock skew tolerated between the frontend and backend hosts. */
const LEEWAY_S = 5;

function unauthorized(): HttpError {
  // One message for every failure: telling a caller WHICH check failed helps
  // an attacker, not a legitimate client.
  return new HttpError(401, "Invalid or expired token");
}

function decodeJson(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw 0;
    return value as Record<string, unknown>;
  } catch {
    throw unauthorized();
  }
}

export function verifyHs256(
  token: string,
  secret: string,
  now: number = Date.now(),
): InternalClaims {
  if (!secret) throw unauthorized();

  const parts = token.split(".");
  if (parts.length !== 3) throw unauthorized();
  const [header, payload, signature] = parts as [string, string, string];

  if (decodeJson(header).alg !== "HS256") throw unauthorized();

  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest();
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw unauthorized();
  }

  const claims = decodeJson(payload);
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_S <= now / 1000) {
    throw unauthorized();
  }
  if (typeof claims.sub !== "string" || claims.sub.length === 0) throw unauthorized();

  return {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : undefined,
  };
}
