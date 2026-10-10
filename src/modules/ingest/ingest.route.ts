import { Router } from "express";
import * as controller from "./ingest.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { runLimit, pipelineLimit, writeLimit } from "../../middleware/limits.ts";

export const ingestRouter = Router();

// Starting a run costs minutes of machine time, so it is both rate-limited hard
// and gated on the shared secret. Status is a cheap read and only needs the
// poll budget — mounting the run limit on the whole router would have capped
// the admin UI's status polling at two calls an hour.
ingestRouter.post("/run", runLimit, requireAdminToken, controller.startRun);
ingestRouter.get("/status", pipelineLimit, controller.status);
// Project ids from e-GP's search, sent by the capture extension (tools/egp-capture).
// A write like any other: gated on the shared secret, fast, queues only.
ingestRouter.post("/capture", writeLimit, requireAdminToken, controller.capture);
