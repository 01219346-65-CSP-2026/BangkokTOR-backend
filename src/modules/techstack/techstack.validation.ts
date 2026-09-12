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

export type CreateTechstackBody = { name: string; category?: string | null };
export type UpdateTechstackBody = Partial<CreateTechstackBody>;

export type ListTechstacksQuery = {
  page: number;
  limit: number;
  sort: TechstackSortField;
  search?: string;
};

export function parseCreateTechstack(body: unknown): CreateTechstackBody {
  const src = asObject(body);
  return {
    name: required(readString(src, "name", 80), "name"),
    category: readString(src, "category", 80) ?? null,
  };
}

export function parseUpdateTechstack(body: unknown): UpdateTechstackBody {
  const src = asObject(body);
  return requireSomething(
    pruneUndefined({
      name: readString(src, "name", 80),
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
