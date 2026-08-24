import express from "express";
import { routes } from "./routes/index.ts";
import { errorHandler, notFound } from "./middleware/errors.ts";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.use(routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
