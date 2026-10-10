import { HttpError } from "../../middleware/errors.ts";
import {
  asObject,
  parsePageQuery,
  pruneUndefined,
  readBoolean,
  readNumber,
  readObjectId,
  readString,
  required,
  requireSomething,
} from "../../shared/utils/parse.ts";

const SORT_FIELDS = ["created_at", "-created_at", "email", "-email"] as const;
export type UserSortField = (typeof SORT_FIELDS)[number];

export const USER_ROLES = ["admin", "client", "agency"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ProfileBody = {
  description?: string;
  budget_min?: number;
  budget_max?: number;
  team_size?: number;
  tech_stacks?: { tech_stack_id: string; years_experience?: number }[];
};

export type CreateUserBody = {
  email: string;
  google_id?: string;
  profile?: ProfileBody;
};

/**
 * `role` is absent from BOTH the create and update shapes, and that is the
 * point of this file.
 *
 * The services used to spread `req.body` straight into `$set`. Because `role`
 * is a real schema field with 'admin' among its enum values, a request of
 * `PATCH /api/user/:id {"role":"admin"}` validated and wrote — self-service
 * privilege escalation, contained only by the admin token on the route. Role
 * changes need their own deliberate endpoint with its own authorisation, not a
 * key in a general-purpose update body.
 *
 * If you add a field to the schema, it does not become writable until it is
 * named here. That inversion is the whole safety property.
 */
export type UpdateUserBody = {
  email?: string;
  profile?: ProfileBody;
};

/**
 * What the frontend sends after a Google sign-in. Only identity fields that
 * Google is the authority for — never `role`, never `profile`, which the user
 * edits through the normal update path.
 */
export type SyncUserBody = {
  google_id: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  avatar_url?: string;
  locale?: string;
};

export type ListUsersQuery = {
  page: number;
  limit: number;
  sort: UserSortField;
  email?: string;
  role?: UserRole;
};

const EMAIL_MAX = 254; // RFC 5321

function readEmail(src: Record<string, unknown>, key: string): string | undefined {
  const value = readString(src, key, EMAIL_MAX);
  if (value === undefined) return undefined;
  // Deliberately loose: the authority on whether an address exists is Google
  // OAuth, not a regex. This only rejects what is obviously not an address.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new HttpError(400, `"${key}" must be an email address`);
  }
  return value.toLowerCase();
}

function readProfile(src: Record<string, unknown>): ProfileBody | undefined {
  if (src.profile === undefined || src.profile === null) return undefined;
  const profile = asObject(src.profile);

  const parsed = pruneUndefined({
    description: readString(profile, "description", 2000),
    budget_min: readNumber(profile, "budget_min", 0),
    budget_max: readNumber(profile, "budget_max", 0),
    team_size: readNumber(profile, "team_size", 1),
    tech_stacks: readTechStacks(profile),
  }) as ProfileBody;

  // A range that excludes everything is a mistake worth naming, not storing.
  if (
    parsed.budget_min !== undefined &&
    parsed.budget_max !== undefined &&
    parsed.budget_min > parsed.budget_max
  ) {
    throw new HttpError(400, '"budget_min" must not exceed "budget_max"');
  }

  return parsed;
}

function readTechStacks(
  profile: Record<string, unknown>,
): { tech_stack_id: string; years_experience?: number }[] | undefined {
  const value = profile.tech_stacks;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, '"tech_stacks" must be an array');

  return value.map((entry) => {
    const row = asObject(entry);
    return pruneUndefined({
      tech_stack_id: required(readObjectId(row, "tech_stack_id"), "tech_stack_id"),
      years_experience: readNumber(row, "years_experience", 0),
    }) as { tech_stack_id: string; years_experience?: number };
  });
}

export function parseCreateUser(body: unknown): CreateUserBody {
  const src = asObject(body);
  return pruneUndefined({
    email: required(readEmail(src, "email"), "email"),
    google_id: readString(src, "google_id", 128),
    profile: readProfile(src),
  }) as CreateUserBody;
}

export function parseUpdateUser(body: unknown): UpdateUserBody {
  const src = asObject(body);

  // Say so plainly rather than silently dropping it — a caller trying to set a
  // role should learn that this is not the endpoint for it.
  if ("role" in src) {
    throw new HttpError(400, '"role" cannot be changed through this endpoint');
  }

  return requireSomething(
    pruneUndefined({
      email: readEmail(src, "email"),
      profile: readProfile(src),
    }),
    "user",
  );
}

const NAME_MAX = 200;

function readAvatarUrl(src: Record<string, unknown>): string | undefined {
  const value = readString(src, "avatar_url", 2048);
  if (value === undefined) return undefined;
  // It ends up in an <img src>; anything but https is either mixed content or
  // a `javascript:`/`data:` payload.
  if (!value.startsWith("https://")) {
    throw new HttpError(400, '"avatar_url" must be an https URL');
  }
  return value;
}

export function parseSyncUser(body: unknown): SyncUserBody {
  const src = asObject(body);
  return pruneUndefined({
    google_id: required(readString(src, "google_id", 128), "google_id"),
    email: required(readEmail(src, "email"), "email"),
    email_verified: readBoolean(src, "email_verified"),
    name: readString(src, "name", NAME_MAX),
    given_name: readString(src, "given_name", NAME_MAX),
    family_name: readString(src, "family_name", NAME_MAX),
    avatar_url: readAvatarUrl(src),
    locale: readString(src, "locale", 35),
  }) as SyncUserBody;
}

export function parseListUsers(query: unknown): ListUsersQuery {
  const src = asObject(query);

  const role = readString(src, "role", 16);
  if (role !== undefined && !USER_ROLES.includes(role as UserRole)) {
    throw new HttpError(400, `"role" must be one of: ${USER_ROLES.join(", ")}`);
  }

  return pruneUndefined({
    ...parsePageQuery(query, SORT_FIELDS, "-created_at"),
    email: readEmail(src, "email"),
    role: role as UserRole | undefined,
  }) as ListUsersQuery;
}
