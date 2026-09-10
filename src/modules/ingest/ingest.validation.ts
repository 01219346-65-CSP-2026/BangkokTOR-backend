import { HttpError } from "../../middleware/errors.ts";

export type RunInput = {
  limit?: number;
  resume: boolean;
};

// A limit is how you get a small first run without changing any code: the full
// scan enqueues 511,606 rows and the fetch stage then runs for days.
export function parseRunInput(body: unknown): RunInput {
  const input = (body ?? {}) as Record<string, unknown>;

  let limit: number | undefined;
  if (input.limit !== undefined && input.limit !== null) {
    const n = Number(input.limit);
    if (!Number.isInteger(n) || n < 1) {
      throw new HttpError(400, "limit must be a positive integer");
    }
    limit = n;
  }

  return { limit, resume: input.resume !== false };
}

export type TorQuery = {
  page: number;
  limit: number;
  agency?: string;
  status?: string;
  q?: string;
  minBudget?: number;
  category?: string;
  isSoftware?: boolean;
};

export function parseTorQuery(query: Record<string, unknown>): TorQuery {
  const page = Math.max(1, Number(query.page ?? 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit ?? 20) || 20));

  const minBudgetRaw = query.minBudget;
  const minBudget =
    minBudgetRaw === undefined || minBudgetRaw === "" ? undefined : Number(minBudgetRaw);
  if (minBudget !== undefined && !Number.isFinite(minBudget)) {
    throw new HttpError(400, "minBudget must be a number");
  }

  // Absent means "don't filter"; only an explicit true/false narrows it.
  let isSoftware: boolean | undefined;
  if (query.isSoftware === "true" || query.isSoftware === true) isSoftware = true;
  else if (query.isSoftware === "false" || query.isSoftware === false) isSoftware = false;

  return {
    page,
    limit,
    agency: typeof query.agency === "string" && query.agency ? query.agency : undefined,
    status: typeof query.status === "string" && query.status ? query.status : undefined,
    q: typeof query.q === "string" && query.q ? query.q : undefined,
    minBudget,
    category: typeof query.category === "string" && query.category ? query.category : undefined,
    isSoftware,
  };
}

export function assertValidId(id: string): string {
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw new HttpError(400, `Invalid id: ${id}`);
  }
  return id;
}
