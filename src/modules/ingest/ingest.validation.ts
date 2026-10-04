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

/** e-GP project number: BE year + month + 7 digits, e.g. 69099316505. */
export const EGP_PROJECT_ID = /^\d{11}$/;
export const MAX_CAPTURE = 2_000;
export const CAPTURE_SOURCES = ["egp-search", "egp-csv"] as const;

export type CapturedProject = { projectId: string; title?: string; agency?: string; province?: string };
export type CaptureInput = {
  projects: CapturedProject[];
  source: (typeof CAPTURE_SOURCES)[number];
  /** Rows that were not an 11-digit e-GP project number. */
  invalid: number;
};

const text = (v: unknown, max = 500) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

/**
 * The capture extension's batch (tools/egp-capture). Bad rows are counted,
 * not fatal: one malformed id must not throw away the rest of a search.
 * Duplicates collapse to the first occurrence.
 */
export function parseCaptureInput(body: unknown): CaptureInput {
  const input = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(input.projects)) throw new HttpError(400, "projects must be an array");
  if (input.projects.length > MAX_CAPTURE) {
    throw new HttpError(400, `at most ${MAX_CAPTURE} projects per call`);
  }

  const seen = new Map<string, CapturedProject>();
  let invalid = 0;
  for (const raw of input.projects) {
    const row = (raw ?? {}) as Record<string, unknown>;
    const projectId = String(row.projectId ?? "").trim();
    if (!EGP_PROJECT_ID.test(projectId)) {
      invalid++;
      continue;
    }
    if (!seen.has(projectId)) {
      seen.set(projectId, {
        projectId,
        title: text(row.title),
        agency: text(row.agency, 200),
        province: text(row.province, 100),
      });
    }
  }

  const source = (CAPTURE_SOURCES as readonly string[]).includes(String(input.source))
    ? (input.source as CaptureInput["source"])
    : "egp-search";
  return { projects: [...seen.values()], source, invalid };
}

export type TorQuery = {
  page: number;
  limit: number;
  agency?: string;
  status?: string;
  q?: string;
  minBudget?: number;
  category?: string;
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

  return {
    page,
    limit,
    agency: typeof query.agency === "string" && query.agency ? query.agency : undefined,
    status: typeof query.status === "string" && query.status ? query.status : undefined,
    q: typeof query.q === "string" && query.q ? query.q : undefined,
    minBudget,
    category: typeof query.category === "string" && query.category ? query.category : undefined,
  };
}

export function assertValidId(id: string): string {
  if (!/^[a-f0-9]{24}$/i.test(id)) {
    throw new HttpError(400, `Invalid id: ${id}`);
  }
  return id;
}
