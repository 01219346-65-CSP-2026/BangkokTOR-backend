import { Router } from "express";
import * as controller from "./extract.controller.ts";

export const extractRouter = Router();

extractRouter.post("/run", controller.startRun);
extractRouter.get("/status", controller.status);
