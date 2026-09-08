import { Router } from "express";
import * as controller from "./ingest.controller.ts";

export const ingestRouter = Router();

ingestRouter.post("/run", controller.startRun);
ingestRouter.get("/status", controller.status);
