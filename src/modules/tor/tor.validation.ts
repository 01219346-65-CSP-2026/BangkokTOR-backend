import { HttpError } from "../../middleware/errors.ts";
import { WORK_TYPES, type WorkTypeId } from "../../lib/classify/workType.ts";
import { SKILL_VOCABULARY } from "../techstack/techstack.vocabulary.ts";
import { TOR_CATEGORIES, TOR_METHODS, TOR_SORTS } from "./tor.model.ts";
import { FIT_BANDS, type FitBand, type InsightsInput, type ListInput } from "./tor.service.ts";
import type { PreviewInput } from "./tor.preview.ts";
import { BIDDING_STATUSES, type BiddingStatus } from "./tor.bidding.ts";
import { BIDDING_STAGES, type BiddingStage } from "../../lib/sources/egp/procurement.ts";

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

/** Unknown work types are dropped like unknown categories. */
function workType(value: unknown): WorkTypeId | undefined {
  return typeof value === "string" && (WORK_TYPES as readonly string[]).includes(value)
    ? (value as WorkTypeId)
    : undefined;
}

function method(value: unknown): TorMethod | undefined {
  return typeof value === "string" && (TOR_METHODS as readonly string[]).includes(value)
    ? (value as TorMethod)
    : undefined;
}

/** An unrecognised sort falls back to the service's default (mostTimeLeft) rather
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

// Sec P11 (T19/T12): none of these is ever legitimately long — a search box
// doesn't need a multi-KB query, and `q` gets regex-matched across four
// fields on every scan. An over-long value is a sign of misuse, not a stale
// client, so (unlike an unknown enum value elsewhere in this file) it is
// rejected rather than silently dropped.
const MAX_Q_LENGTH = 200;
const MAX_AGENCY_LENGTH = 200;
const MAX_PROVINCE_LENGTH = 64;

function boundedString(value: unknown, field: string, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) {
    throw new HttpError(400, `"${field}" must be at most ${max} characters`);
  }
  return trimmed;
}

/** The procurement stage. Unknown values are dropped like an unknown category. */
function stage(value: unknown): BiddingStage | undefined {
  return typeof value === "string" && (BIDDING_STAGES as readonly string[]).includes(value)
    ? (value as BiddingStage)
    : undefined;
}

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

const isBidding = (v: string): v is BiddingStatus => (BIDDING_STATUSES as readonly string[]).includes(v);

/** "open,upcoming". Unknown values are dropped; nothing left → the default. */
function bidding(value: unknown): BiddingStatus[] | undefined {
  const out = csv(value, isBidding, BIDDING_STATUSES.length);
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

  return {
    q: boundedString(query.q, "q", MAX_Q_LENGTH),
    agency: boundedString(query.agency, "agency", MAX_AGENCY_LENGTH),
    category: category(query.category),
    method: method(query.method),
    province: boundedString(query.province, "province", MAX_PROVINCE_LENGTH),
    stage: stage(query.stage),
    workType: workType(query.workType),
    minBudget: num(query.minBudget),
    maxBudget: num(query.maxBudget),
    publishedFrom: date(query.publishedFrom),
    publishedTo: date(query.publishedTo),
    sort: sort(query.sort),
    skills: skills(query.skills),
    fit: fitBands(query.fit),
    bidding: bidding(query.bidding),
    page,
    limit,
  };
}

/** GET /api/tors/insights. A blank, array, or overlong province is no province. */
export function parseInsightsQuery(query: Record<string, unknown>): InsightsInput {
  const value = query.province;
  const province =
    typeof value === "string" && value.trim() && value.trim().length <= MAX_PROVINCE_LENGTH
      ? value.trim()
      : undefined;
  return { province };
}

/** GET /api/tors/preview. A missing or odd seed still gets a stable pick. */
export function parsePreviewQuery(query: Record<string, unknown>): PreviewInput {
  const seed = typeof query.seed === "string" ? query.seed.slice(0, 32) : "";
  return {
    skills: skills(query.skills) ?? [],
    minBudget: num(query.minBudget),
    maxBudget: num(query.maxBudget),
    seed,
  };
}
