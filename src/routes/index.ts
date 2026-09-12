import { Router } from "express";
import { healthRouter } from "./health.route.ts";
import { notificationRouter } from "../modules/notification/notification.route.ts";
import { techstackRouter } from "../modules/techstack/techstack.route.ts";
import { userRouter } from "../modules/user/user.route.ts";
import { ingestRouter } from "../modules/ingest/ingest.route.ts";
import { extractRouter } from "../modules/extract/extract.route.ts";
import { gradeRouter } from "../modules/grade/grade.route.ts";
import { torRouter } from "../modules/tor/tor.route.ts";
import { monitorRouter } from "../modules/monitor/monitor.route.ts";
import { readLimit, pipelineLimit, writeLimit } from "../middleware/limits.ts";

export const routes = Router();

routes.get("/", (_req, res) => {
  res.json({ message: "BangkokTOR backend is running" });
});

// Health is deliberately unlimited: Docker's healthcheck hits it every 30s and
// a limiter here would mark a busy container unhealthy.
routes.use(healthRouter);

// modules/_template is the reference implementation — route, controller,
// service, model, validation — kept as documentation, not mounted. Its
// validation layer is what src/shared/utils/parse.ts was lifted from after
// three copies of it shipped without one.

// The ingest/extract/grade routers set their own tiers per route, because
// `/run` and `/status` in the same router need different budgets.
routes.use("/api/notification", writeLimit, notificationRouter);
routes.use("/api/techstack", writeLimit, techstackRouter);
routes.use("/api/user", writeLimit, userRouter);
routes.use("/api/ingest", ingestRouter);
routes.use("/api/extract", extractRouter);
routes.use("/api/grade", gradeRouter);
routes.use("/api/tors", readLimit, torRouter);
routes.use("/api/pipeline", pipelineLimit, monitorRouter);
