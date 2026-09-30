import { Router } from "express";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { writeLimit } from "../../middleware/limits.ts";
import { flushWorkers, queue, retry, runs, status, stopWorkers } from "./monitor.controller.ts";

// Operational views for the admin dashboard (FR-07).
//
// NOTE: these are unauthenticated, like every other route here — the API has no
// auth layer yet. They expose worker hostnames, pids and failure reasons, so
// keep CORS_ORIGINS tight and prefer reaching them through the frontend's
// server-side proxy rather than exposing this port publicly.

export const monitorRouter = Router();

monitorRouter.get("/status", status);
monitorRouter.get("/queue", queue);
monitorRouter.get("/runs", runs);

// Controls. Admin-token gated like the /run endpoints, but on the write tier:
// runLimit (2/hour) is sized for multi-minute runs, not for clicking Retry.
// They change what the pipeline does, so they must not be reachable by
// anything that can merely read status.
monitorRouter.post("/workers/stop", writeLimit, requireAdminToken, stopWorkers);
monitorRouter.post("/workers/flush", writeLimit, requireAdminToken, flushWorkers);
monitorRouter.post("/errors/:id/retry", writeLimit, requireAdminToken, retry);
