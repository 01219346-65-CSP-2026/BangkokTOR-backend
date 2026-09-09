import { Router } from "express";
import * as controller from "./tor.controller.ts";

export const torRouter = Router();

// Static segments before the :id route, or "stats" is read as an id.
torRouter.get("/stats", controller.stats);
torRouter.get("/agencies", controller.agencies);
torRouter.get("/", controller.list);
torRouter.get("/:id", controller.detail);
torRouter.get("/:id/grade", controller.grade);
