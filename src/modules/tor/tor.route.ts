import { Router } from "express";
import * as controller from "./tor.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";

export const torRouter = Router();

// Static segments before the :id route, or "stats" is read as an id.
torRouter.get("/stats", controller.stats);
torRouter.get("/agencies", controller.agencies);
torRouter.get("/", controller.list);
torRouter.get("/:id", controller.detail);

// The private grade: a letter grade plus verbatim evidence quotes about a named
// government agency. The FR-19 gate in tor.serialize.ts keeps it off every
// public response, and this keeps its own route off the public internet.
torRouter.get("/:id/grade", requireAdminToken, controller.grade);
