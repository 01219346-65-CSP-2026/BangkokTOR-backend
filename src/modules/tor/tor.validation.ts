import { SKILL_VOCABULARY } from "../techstack/techstack.vocabulary.ts";
import { TOR_CATEGORIES, TOR_METHODS, TOR_SORTS } from "./tor.model.ts";
import { FIT_BANDS, type FitBand, type ListInput } from "./tor.service.ts";

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

const SKILL_SLUGS = new Set<string>(SKILL_VOCABULARY.map((s) => s.slug));
/** More than the whole vocabulary is never legitimate. */
const MAX_SKILLS = SKILL_VOCABULARY.length;

/** Comma-separated values, deduplicated, keeping only the ones `keep` knows. */
function csv<T extends string>(value: unknown, keep: (v: string) => v is T, max: number): T[] {
  if (typeof value !== "string" || !value) return [];
  return [...new Set(value.split(",").map((v) => v.trim()))].filter(keep).slice(0, max);
}

const isSkill = (v: string): v is string => SKILL_SLUGS.has(v);
const isFitBand = (v: string): v is FitBand => (FIT_BANDS as readonly string[]).includes(v);

/** The reader's profile skills, as slugs. Unknown slugs are dropped like an
 *  unknown category is — a stale client must not turn into a 400. */
function skills(value: unknown): string[] | undefined {
  const out = csv(value, isSkill, MAX_SKILLS);
  return out.length > 0 ? out : undefined;
}

function fitBands(value: unknown): FitBand[] | undefined {
  const out = csv(value, isFitBand, FIT_BANDS.length);
  return out.length > 0 ? out : undefined;
}

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
    skills: skills(query.skills),
    fit: fitBands(query.fit),
    page,
    limit,
  };
}
