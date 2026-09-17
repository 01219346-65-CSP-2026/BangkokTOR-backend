import type { RequestHandler } from "express";
import { env, isProduction } from "../config/env.ts";
import { HttpError } from "./errors.ts";

/**
 * A shared-secret gate for the routes that must not be open to the internet:
 * the three `POST /run` endpoints that kick off expensive pipeline work, the
 * user/notification/techstack writes, and the private grade route.
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
  if (!env.adminToken && !isProduction) {
    next();
    return;
  }

  const header = req.headers["x-admin-token"];
  const provided = Array.isArray(header) ? header[0] : header;

  if (!provided || !env.adminToken || provided !== env.adminToken) {
    next(new HttpError(404, `Not found: ${req.method} ${req.originalUrl}`));
    return;
  }

  next();
};
