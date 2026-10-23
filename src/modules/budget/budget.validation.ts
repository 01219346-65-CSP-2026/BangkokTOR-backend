import type { BudgetInsightsInput } from "./budget.service.ts";

/** Fiscal years the BMA portal has budgets for, with room to grow. */
const MIN_YEAR = 2560;
const MAX_YEAR = 2600;

/** GET /api/budget/insights. A missing or odd `year` means this fiscal year. */
export function parseBudgetInsightsQuery(query: Record<string, unknown>): BudgetInsightsInput {
  const raw = typeof query.year === "string" ? Number(query.year) : NaN;
  const year = Number.isInteger(raw) && raw >= MIN_YEAR && raw <= MAX_YEAR ? raw : undefined;
  return { year };
}
