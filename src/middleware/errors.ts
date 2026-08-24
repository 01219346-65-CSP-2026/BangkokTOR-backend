import type { ErrorRequestHandler, RequestHandler } from "express";
import { isProduction } from "../config/env.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.originalUrl}` });
};

// Express 5 forwards rejected async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message =
    err instanceof HttpError ? err.message : isProduction ? "Internal server error" : String(err);

  if (status >= 500) console.error(err);

  res.status(status).json({ error: message });
};
