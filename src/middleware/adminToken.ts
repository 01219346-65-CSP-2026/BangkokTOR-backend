import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env, isProduction } from "../config/env.ts";
import { HttpError } from "./errors.ts";

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

/**
 * ADMIN_TOKEN gates privileged routes; CAPTURE_TOKEN is additionally accepted
 * only by `POST /api/ingest/capture`.
 *
 * This is not a user auth system — it does not identify anyone. It is the
 * smallest thing that stops an anonymous caller from saturating the box or
 * deleting rows, until real auth lands (FR-01).
 *
 * It answers 404, not 403: a 403 confirms the route exists and that a token is
 * what's missing. A 404 tells a scanner nothing it didn't already have.
 */
export const requireAdminToken: RequestHandler = (req, res, next) => {
  // Dev with no token configured stays frictionless; production does not get
  // that choice — see the boot assertion in config/env.ts.
  if (!env.adminToken && !env.captureToken && !isProduction) {
    next();
    return;
  }

  const header = req.headers["x-admin-token"];
  const provided = Array.isArray(header) ? header[0] : header;

  if (!provided) {
    next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
    return;
  }

  const isCaptureRoute =
    req.method === "POST" &&
    req.baseUrl === "/api/ingest" &&
    req.path.replace(/\/+$/, "") === "/capture";
  const matchesAdminToken =
    env.adminToken !== "" && tokensMatch(provided, env.adminToken);
  const matchesCaptureToken =
    isCaptureRoute &&
    env.captureToken !== "" &&
    tokensMatch(provided, env.captureToken);

  if (!matchesAdminToken && !matchesCaptureToken) {
    next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
    return;
  }

  next();
};
