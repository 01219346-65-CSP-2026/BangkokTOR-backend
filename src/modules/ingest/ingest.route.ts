import { Router } from "express";
import * as controller from "./ingest.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { runLimit, pipelineLimit, writeLimit } from "../../middleware/limits.ts";

export const ingestRouter = Router();

// Starting a run costs minutes of machine time, so it is both rate-limited hard
// and gated on the shared secret. Status is a cheap read and only needs the
// poll budget — mounting the run limit on the whole router would have capped
// the admin UI's status polling at two calls an hour.
//
// Neither /run nor /capture goes through requireUser/requireRole: /run has no
// HTTP caller at all (the discover CLI calls the service directly, see
// src/discover.ts), and /capture is called cross-origin by the egp-capture
// Chrome extension (tools/egp-capture), which never holds a signed-in session
// or an internal JWT — only the shared admin token (see middleware/cors.ts
// CAPTURE_PATH). Neither is reachable through the admin web panel's session
// flow, so they are not part of the role-gating in this change.
ingestRouter.post("/run", runLimit, requireAdminToken, controller.startRun);
ingestRouter.get("/status", pipelineLimit, controller.status);
// Project ids from e-GP's search, sent by the capture extension (tools/egp-capture).
// A write like any other: gated on the shared secret, fast, queues only.
ingestRouter.post("/capture", writeLimit, requireAdminToken, controller.capture);
