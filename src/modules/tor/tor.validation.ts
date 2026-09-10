import { TOR_CATEGORIES } from "./tor.model.ts";
import type { ListInput } from "./tor.service.ts";

type TorCategory = (typeof TOR_CATEGORIES)[number];

/** An unknown category is dropped, not passed through: Mongoose would reject
 *  it against the enum anyway, and a 500 is the wrong answer to a typo. */
function category(value: unknown): TorCategory | undefined {
  return typeof value === "string" && (TOR_CATEGORIES as readonly string[]).includes(value)
    ? (value as TorCategory)
    : undefined;
}

const MAX_LIMIT = 100;

function num(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Query strings are all `string | undefined`; this is the only place that
 *  becomes typed input, so a bad page number can't reach a database query. */
export function parseListQuery(query: Record<string, unknown>): ListInput {
  const page = Math.max(1, Math.floor(num(query.page) ?? 1));
  const rawLimit = Math.floor(num(query.limit) ?? 20);
  const limit = Math.min(MAX_LIMIT, Math.max(1, rawLimit));

  const isSoftware =
    query.isSoftware === "true" ? true : query.isSoftware === "false" ? false : undefined;

  return {
    q: typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined,
    agency: typeof query.agency === "string" ? query.agency : undefined,
    category: category(query.category),
    province: typeof query.province === "string" ? query.province : undefined,
    isSoftware,
    minBudget: num(query.minBudget),
    maxBudget: num(query.maxBudget),
    page,
    limit,
  };
}
