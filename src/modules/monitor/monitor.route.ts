import { Router } from "express";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { requireUser } from "../../middleware/requireUser.ts";
import { requireRole } from "../../middleware/requireRole.ts";
import { writeLimit } from "../../middleware/limits.ts";
import { flushWorkers, queue, retry, runs, status, stopWorkers } from "./monitor.controller.ts";

// Operational views for the admin dashboard (FR-07).
//
// This is the only backend surface the admin web panel actually reaches (via
// the frontend's src/app/api/pipeline/[...path]/route.ts, which always signs
// an internal JWT through authedFetch/adminFetch — nothing else calls this
// router). requireUser + requireRole("admin") is the real fix for "a
// signed-in non-admin can reach the admin panel": before this, the proxy only
// checked that SOMEONE was signed in. These still expose worker hostnames,
// pids and failure reasons, so this still sits behind CORS_ORIGINS and is
// still meant to be reached through that proxy rather than this port
// directly.
export const monitorRouter = Router();
monitorRouter.use(requireUser, requireRole("admin"));

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
