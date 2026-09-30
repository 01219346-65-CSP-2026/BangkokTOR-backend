import { TOR_CATEGORIES, TOR_METHODS, TOR_SORTS } from "./tor.model.ts";
import type { ListInput } from "./tor.service.ts";

type TorCategory = (typeof TOR_CATEGORIES)[number];
type TorMethod = (typeof TOR_METHODS)[number];
type TorSort = (typeof TOR_SORTS)[number];

/** An unknown category is dropped, not passed through: Mongoose would reject
 *  it against the enum anyway, and a 500 is the wrong answer to a typo. */
function category(value: unknown): TorCategory | undefined {
  return typeof value === "string" && (TOR_CATEGORIES as readonly string[]).includes(value)
    ? (value as TorCategory)
    : undefined;
}

function method(value: unknown): TorMethod | undefined {
  return typeof value === "string" && (TOR_METHODS as readonly string[]).includes(value)
    ? (value as TorMethod)
    : undefined;
}

/** An unrecognised sort falls back to the service's default (newest) rather
 *  than erroring — same reasoning as an unknown category. */
function sort(value: unknown): TorSort | undefined {
  return typeof value === "string" && (TOR_SORTS as readonly string[]).includes(value)
    ? (value as TorSort)
    : undefined;
}

/** Only a well-formed date reaches the query; anything else is dropped so an
 *  unparsable value can't collapse the range to an always-false filter. */
function date(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
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
    method: method(query.method),
    province: typeof query.province === "string" ? query.province : undefined,
    isSoftware,
    minBudget: num(query.minBudget),
    maxBudget: num(query.maxBudget),
    publishedFrom: date(query.publishedFrom),
    publishedTo: date(query.publishedTo),
    sort: sort(query.sort),
    page,
    limit,
  };
}
