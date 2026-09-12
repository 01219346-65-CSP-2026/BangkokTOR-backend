import type { RequestHandler } from "express";

/**
 * One line per request: method, path, status, duration.
 *
 * There was no logging at all before, which made a 429 or a refused CORS
 * origin unverifiable in prod — the only evidence a limiter is working is a
 * log line saying it fired.
 */
export const requestLog: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();

  res.on("finish", () => {
    const ms = Math.round(performance.now() - startedAt);
    // Health checks fire every 30s and would drown everything else.
    if (req.originalUrl.startsWith("/health")) return;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`,
    );
  });

  next();
};
