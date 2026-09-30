import { HttpError } from "../../middleware/errors.ts";
import {
  asObject,
  parsePageQuery,
  pruneUndefined,
  readString,
  required,
  requireSomething,
} from "../../shared/utils/parse.ts";

const SORT_FIELDS = ["name", "-name", "created_at", "-created_at"] as const;
export type TechstackSortField = (typeof SORT_FIELDS)[number];

export type CreateTechstackBody = { name: string; slug?: string; category?: string | null };
export type UpdateTechstackBody = Partial<CreateTechstackBody>;

export type ListTechstacksQuery = {
  page: number;
  limit: number;
  sort: TechstackSortField;
  search?: string;
};

/** Same alphabet as the frontend's SkillIds: camelCase ASCII. */
function readSlug(src: Record<string, unknown>): string | undefined {
  const slug = readString(src, "slug", 40);
  if (slug !== undefined && !/^[a-zA-Z][a-zA-Z0-9]*$/.test(slug)) {
    throw new HttpError(400, '"slug" must be letters and digits, starting with a letter');
  }
  return slug;
}

export function parseCreateTechstack(body: unknown): CreateTechstackBody {
  const src = asObject(body);
  return {
    name: required(readString(src, "name", 80), "name"),
    ...pruneUndefined({ slug: readSlug(src) }),
    category: readString(src, "category", 80) ?? null,
  };
}

export function parseUpdateTechstack(body: unknown): UpdateTechstackBody {
  const src = asObject(body);
  return requireSomething(
    pruneUndefined({
      name: readString(src, "name", 80),
      slug: readSlug(src),
      category: readString(src, "category", 80),
    }),
    "techstack",
  );
}

export function parseListTechstacks(query: unknown): ListTechstacksQuery {
  const src = asObject(query);
  return {
    ...parsePageQuery(query, SORT_FIELDS, "name"),
    search: readString(src, "search", 80),
  };
}
