import express from "express";
import { routes } from "./routes/index.ts";
import { cors } from "./middleware/cors.ts";
import { requestLog } from "./middleware/requestLog.ts";
import { errorHandler, notFound } from "./middleware/errors.ts";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Behind Caddy the socket address is the proxy's for every request, so the
  // limiter reads the leftmost X-Forwarded-For entry instead. That is only
  // trustworthy because 8003 is no longer published to the host — nothing
  // reaches the app except through the proxy, which rewrites the header.
  app.set("trust proxy", 1);

  app.use(requestLog);
  // Before the body parser: a preflight carries no body and should be answered
  // without one being parsed.
  app.use(cors);
  // A capture batch (up to 2,000 projects with titles) passes the 100 KB
  // default; only that route gets the larger limit.
  app.use("/api/ingest/capture", express.json({ limit: "2mb" }));
  app.use(express.json());

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
