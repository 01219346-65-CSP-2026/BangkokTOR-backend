import { Router } from "express";
import { mongoState, pingMongo } from "../db/mongo.ts";

export const healthRouter = Router();

/** Liveness: is the process up? Never touches dependencies. */
healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

/** Readiness: can we actually serve traffic? Checks Mongo. */
healthRouter.get("/health/ready", async (_req, res) => {
  const mongoOk = await pingMongo();

  res.status(mongoOk ? 200 : 503).json({
    status: mongoOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    checks: {
      mongo: { ok: mongoOk, state: mongoState() },
    },
  });
});
