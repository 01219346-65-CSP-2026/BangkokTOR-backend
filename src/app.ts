import express from "express";
import { routes } from "./routes/index.ts";
import { cors } from "./middleware/cors.ts";
import { errorHandler, notFound } from "./middleware/errors.ts";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  // Before the body parser: a preflight carries no body and should be answered
  // without one being parsed.
  app.use(cors);
  app.use(express.json());

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
