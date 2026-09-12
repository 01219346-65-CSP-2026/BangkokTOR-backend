import { Router } from "express";
import * as controller from "./ingest.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { runLimit, pipelineLimit } from "../../middleware/limits.ts";

export const ingestRouter = Router();

// Starting a run costs minutes of machine time, so it is both rate-limited hard
// and gated on the shared secret. Status is a cheap read and only needs the
// poll budget — mounting the run limit on the whole router would have capped
// the admin UI's status polling at two calls an hour.
ingestRouter.post("/run", runLimit, requireAdminToken, controller.startRun);
ingestRouter.get("/status", pipelineLimit, controller.status);
