import { Router } from "express";
import { healthRouter } from "./health.route.ts";
import { ingestRouter } from "../modules/ingest/ingest.route.ts";
import { extractRouter } from "../modules/extract/extract.route.ts";
import { gradeRouter } from "../modules/grade/grade.route.ts";
import { torRouter } from "../modules/tor/tor.route.ts";

export const routes = Router();

routes.get("/", (_req, res) => {
  res.json({ message: "BangkokTOR backend is running" });
});

routes.use(healthRouter);
routes.use("/api/ingest", ingestRouter);
routes.use("/api/extract", extractRouter);
routes.use("/api/grade", gradeRouter);
routes.use("/api/tors", torRouter);
