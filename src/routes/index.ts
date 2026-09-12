import { Router } from "express";
import { healthRouter } from "./health.route.ts";
import { exampleRouter } from "../modules/_template/example.route.ts";
import { thingRouter } from "../modules/_thing/thing.route.ts";
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

//routes.use("/api/example", exampleRouter);
//routes.use("/api/thing", thingRouter);

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
