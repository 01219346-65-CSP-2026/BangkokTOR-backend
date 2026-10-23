import type { RequestHandler } from "express";
import { HttpError } from "./errors.ts";

/**
 * Gate on the role requireUser resolved onto `res.locals.role`. Must run
 * after requireUser — it has no way to identify anyone on its own.
 */
export function requireRole(role: string): RequestHandler {
  return (_req, res, next) => {
    if (res.locals.role !== role) {
      next(new HttpError(403, "Forbidden"));
      return;
    }
    next();
  };
}
