import { isValidObjectId } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";

/**
 * Primitives for turning untrusted `unknown` input into typed values, or 400.
 *
 * Lifted out of modules/_template/example.validation.ts, which had all of this
 * and was copied three times WITHOUT it — the CRUD modules passed `req.body`
 * straight into `$set` and `req.query.sort` straight into Mongoose. Sharing the
 * helpers is what stops the next copy dropping them again.
 *
 * Hand-rolled to keep the dependency list at three packages (AGENTS.md). If zod
 * ever lands, replace the bodies and keep the signatures.
 */

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

export function readString(
  src: Record<string, unknown>,
  key: string,
  max: number,
): string | undefined {
  const value = src[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `"${key}" must be a string`);

  const trimmed = value.trim();
  if (trimmed.length === 0) throw new HttpError(400, `"${key}" must not be empty`);
  if (trimmed.length > max) {
    throw new HttpError(400, `"${key}" must be ${max} characters or fewer`);
  }
  return trimmed;
}

export function readNumber(
  src: Record<string, unknown>,
  key: string,
  min: number,
): number | undefined {
  const value = src[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `"${key}" must be a number`);
  }
  if (value < min) throw new HttpError(400, `"${key}" must be at least ${min}`);
  return value;
}

export function readBoolean(
  src: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = src[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new HttpError(400, `"${key}" must be a boolean`);
  return value;
}

/** An ObjectId as a string. Rejects here rather than letting Mongo CastError 500. */
export function readObjectId(
  src: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = src[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !isValidObjectId(value)) {
    throw new HttpError(400, `"${key}" must be a valid id`);
  }
  return value;
}

export function readDate(src: Record<string, unknown>, key: string): Date | undefined {
  const value = src[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new HttpError(400, `"${key}" must be an ISO date string`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, `"${key}" is not a valid date`);
  return date;
}

export function required<T>(value: T | undefined, key: string): T {
  if (value === undefined) throw new HttpError(400, `"${key}" is required`);
  return value;
}

/**
 * Drop the keys the caller never sent.
 *
 * Without this, `$set` writes `undefined` over fields the request did not
 * mention — a PATCH of one field would blank the others.
 */
export function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

/** At least one field, or the PATCH is a no-op the caller should know about. */
export function requireSomething<T extends Record<string, unknown>>(input: T, what: string): T {
  if (Object.keys(input).length === 0) {
    throw new HttpError(400, `Provide at least one field to update on ${what}`);
  }
  return input;
}

export const MAX_LIMIT = 100;

export type ParsedListQuery<TSort extends string> = {
  page: number;
  limit: number;
  sort: TSort;
};

/**
 * Page, limit and sort from a query string.
 *
 * `sort` is whitelisted against the caller's own field list. Passing it through
 * unchecked — which all three CRUD services did — let `?sort[x]=y` reach the
 * driver and throw a raw 500.
 */
export function parsePageQuery<TSort extends string>(
  query: unknown,
  sortFields: readonly TSort[],
  defaultSort: TSort,
): ParsedListQuery<TSort> {
  const src = asObject(query);

  const page = Math.max(1, Number(src.page ?? 1) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(src.limit ?? 20) || 20));

  // A missing sort takes the default; a PRESENT one must be a valid string.
  // Coercing a non-string to the default instead would silently accept
  // `?sort[$ne]=null` — Express parses that into an object, and quietly
  // ignoring it is how an injection-shaped query looks like a success.
  if (src.sort !== undefined && typeof src.sort !== "string") {
    throw new HttpError(400, `"sort" must be a string`);
  }

  const rawSort = src.sort ?? defaultSort;
  if (!sortFields.includes(rawSort as TSort)) {
    throw new HttpError(400, `"sort" must be one of: ${sortFields.join(", ")}`);
  }

  return { page, limit, sort: rawSort as TSort };
}

/** Mongo's duplicate-key error. A 409, never a 500. */
export function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}
