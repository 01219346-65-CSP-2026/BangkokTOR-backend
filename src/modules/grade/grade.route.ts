import { Router } from "express";
import * as controller from "./grade.controller.ts";

export const gradeRouter = Router();

gradeRouter.post("/run", controller.startRun);
gradeRouter.get("/status", controller.status);
