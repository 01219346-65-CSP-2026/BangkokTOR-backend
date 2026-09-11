import type { RequestHandler } from "express";
import { env } from "../config/env.ts";

// Hand-rolled rather than the `cors` package: this needs about fifteen lines,
// and the repo's dependency list is short on purpose.
//
// Origins are an allowlist reflected back one at a time, never `*`. The API has
// no auth, so the CORS header is currently the only thing standing between a
// stranger's browser tab and the whole pipeline's internals.

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;

  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // The allowed origin varies by request, so any shared cache must key on it.
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  // Preflight ends here — it must not fall through to the routes and 404.
  if (req.method === "OPTIONS") {
    res.sendStatus(origin && env.corsOrigins.includes(origin) ? 204 : 403);
    return;
  }

  next();
};
