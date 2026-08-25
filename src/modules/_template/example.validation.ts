import { HttpError } from "../../middleware/errors.ts";

/**
 * The VALIDATION layer turns untrusted `unknown` input into a typed value, or
 * throws 400. Everything downstream — controller, service, model — gets to
 * assume its input is already the right shape.
 *
 * This is hand-rolled to keep the template dependency-free. In a real project
 * reach for zod (`bun add zod`) and replace each `parse*` body with a schema:
 *
 *   const createSchema = z.object({ name: z.string().trim().max(120), ... });
 *   export const parseCreateInput = (body: unknown) => createSchema.parse(body);
 *
 * The signatures below stay identical, so nothing else has to change.
 */

const SORT_FIELDS = ["createdAt", "-createdAt", "name", "-name", "priceTHB", "-priceTHB"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const MAX_LIMIT = 100;

export type CreateExampleInput = {
  name: string;
  slug: string;
  description: string;
  priceTHB: number;
  tags: string[];
  isPublished: boolean;
};

/** Every field optional — but `undefined` means "leave alone", never "set to null". */
export type UpdateExampleInput = Partial<CreateExampleInput>;

export type ListExamplesQuery = {
  page: number;
  limit: number;
  sort: SortField;
  tag?: string;
  search?: string;
  published?: boolean;
};

// ---------------------------------------------------------------------------
// primitives
// ---------------------------------------------------------------------------

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HttpError(400, "Request body must be a JSON object");
  }
  return value as Record<string, unknown>;
}

function readString(src: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = src[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new HttpError(400, `"${key}" must be a string`);

  const trimmed = value.trim();
  if (trimmed.length === 0) throw new HttpError(400, `"${key}" must not be empty`);
  if (trimmed.length > max) throw new HttpError(400, `"${key}" must be ${max} characters or fewer`);
  return trimmed;
}

function readNumber(src: Record<string, unknown>, key: string, min: number): number | undefined {
  const value = src[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `"${key}" must be a number`);
  }
  if (value < min) throw new HttpError(400, `"${key}" must be at least ${min}`);
  return value;
}

function readBoolean(src: Record<string, unknown>, key: string): boolean | undefined {
  const value = src[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new HttpError(400, `"${key}" must be a boolean`);
  return value;
}

function readStringArray(src: Record<string, unknown>, key: string): string[] | undefined {
  const value = src[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new HttpError(400, `"${key}" must be an array of strings`);
  }
  return (value as string[]).map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function required<T>(value: T | undefined, key: string): T {
  if (value === undefined) throw new HttpError(400, `"${key}" is required`);
  return value;
}

// ---------------------------------------------------------------------------
// parsers — the only exports the rest of the module uses
// ---------------------------------------------------------------------------

export function parseCreateInput(body: unknown): CreateExampleInput {
  const src = asObject(body);

  return {
    name: required(readString(src, "name", 120), "name"),
    slug: required(readString(src, "slug", 120), "slug").toLowerCase(),
    description: readString(src, "description", 2000) ?? "",
    priceTHB: required(readNumber(src, "priceTHB", 0), "priceTHB"),
    tags: readStringArray(src, "tags") ?? [],
    isPublished: readBoolean(src, "isPublished") ?? false,
  };
}

export function parseUpdateInput(body: unknown): UpdateExampleInput {
  const src = asObject(body);

  const input: UpdateExampleInput = {
    name: readString(src, "name", 120),
    slug: readString(src, "slug", 120)?.toLowerCase(),
    description: readString(src, "description", 2000),
    priceTHB: readNumber(src, "priceTHB", 0),
    tags: readStringArray(src, "tags"),
    isPublished: readBoolean(src, "isPublished"),
  };

  // Strip the keys the caller never sent, so `$set` doesn't overwrite with undefined.
  for (const key of Object.keys(input) as (keyof UpdateExampleInput)[]) {
    if (input[key] === undefined) delete input[key];
  }

  if (Object.keys(input).length === 0) {
    throw new HttpError(400, "Provide at least one field to update");
  }

  return input;
}

/** Query strings arrive as strings (or arrays) — never trust the type. */
export function parseListQuery(query: unknown): ListExamplesQuery {
  const src = asObject(query);

  const page = Math.max(1, Number(src.page ?? 1) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(src.limit ?? 20) || 20));

  const rawSort = typeof src.sort === "string" ? src.sort : "-createdAt";
  if (!SORT_FIELDS.includes(rawSort as SortField)) {
    throw new HttpError(400, `"sort" must be one of: ${SORT_FIELDS.join(", ")}`);
  }

  return {
    page,
    limit,
    sort: rawSort as SortField,
    tag: typeof src.tag === "string" ? src.tag : undefined,
    search: typeof src.search === "string" ? src.search : undefined,
    published: src.published === undefined ? undefined : src.published === "true",
  };
}
