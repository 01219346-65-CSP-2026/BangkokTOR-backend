import type { Request, Response } from "express";
import * as service from "./budget.service.ts";
import { parseBudgetInsightsQuery } from "./budget.validation.ts";

export async function insights(req: Request, res: Response) {
  res.json(await service.getBudgetInsights(parseBudgetInsightsQuery(req.query as Record<string, unknown>)));
}
