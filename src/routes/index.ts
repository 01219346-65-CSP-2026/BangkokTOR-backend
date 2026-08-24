import { Router } from "express";
import { healthRouter } from "./health.route.ts";

export const routes = Router();

routes.get("/", (_req, res) => {
  res.json({ message: "BangkokTOR backend is running" });
});

routes.use(healthRouter);
// Mount feature routers here, e.g. routes.use("/tours", toursRouter);
