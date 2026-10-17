import { Router } from "express";
import * as controller from "./budget.controller.ts";

/** Bangkok's annual budget against the TORs that spend it. Read-only; the
 *  data is written by `bun run import-budget`. */
export const budgetRouter = Router();

budgetRouter.get("/insights", controller.insights);
