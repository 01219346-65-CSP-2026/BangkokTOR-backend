import type { RequestHandler } from "express";
import { env, isProduction } from "../config/env.ts";

// Hand-rolled rather than the `cors` package: this needs about fifteen lines,
// and the repo's dependency list is short on purpose.
//
// Origins are an allowlist reflected back one at a time, never `*`. The API has
// no auth, so the CORS header is currently the only thing standing between a
// stranger's browser tab and the whole pipeline's internals.

function isAllowed(origin: string | undefined): origin is string {
  return Boolean(origin) && env.corsOrigins.includes(origin!);
}

export const cors: RequestHandler = (req, res, next) => {
  const origin = req.headers.origin;
  const allowed = isAllowed(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    // The allowed origin varies by request, so any shared cache must key on it.
    res.setHeader("Vary", "Origin");
    // PATCH and DELETE are registered by the user/notification/techstack
    // routers, so omitting them here meant the browser refused a preflight for
    // a route that exists.
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PATCH,DELETE,OPTIONS",
    );
    // X-Admin-Token gates the writes and the private grade route; a preflight
    // that does not list it fails before the request is ever sent.
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-Admin-Token",
    );
    res.setHeader("Access-Control-Max-Age", "600");
  } else if (origin && !isProduction) {
    // A blocked origin surfaces in the browser only as an opaque CORS failure
    // with no cause, so say plainly on this side which value was rejected and
    // what would fix it. Dev only — in production this would be log noise from
    // every scanner that finds the port.
    console.warn(
      `CORS: refused origin ${origin} — not in CORS_ORIGINS ` +
        `(${env.corsOrigins.join(", ") || "empty"}). Add it to the backend .env.`,
    );
  }

  // Preflight ends here — it must not fall through to the routes and 404.
  if (req.method === "OPTIONS") {
    if (allowed) {
      res.sendStatus(204);
      return;
    }
    // 403 with a readable reason. The browser hides the body from the page, but
    // it is visible in the network panel and in curl, which is where anyone
    // debugging this is actually looking.
    res.status(403).json({
      error: "Origin not allowed",
      origin: origin ?? null,
      hint: "Add this origin to CORS_ORIGINS in the backend .env, then restart.",
    });
    return;
  }

  next();
};
