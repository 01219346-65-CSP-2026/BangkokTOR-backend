import { HttpError } from "../../middleware/errors.ts";
import { SKILL_VOCABULARY } from "../techstack/techstack.vocabulary.ts";
import {
  asObject,
  readBoolean,
  readNumber,
  readString,
  required,
} from "../../shared/utils/parse.ts";

export const TEAM_SIZE_BANDS = ["solo", "small", "medium", "large", "xlarge"] as const;
export const DURATIONS = ["short", "medium", "long", "veryLong"] as const;

export type TeamSizeBand = (typeof TEAM_SIZE_BANDS)[number];
export type Duration = (typeof DURATIONS)[number];

/**
 * The skill profile as the wizard edits it. PUT replaces it whole — the wizard
 * always holds the complete profile, and a full replace means a field can
 * never be left half-updated by a partial body.
 *
 * `skills` are TechStack slugs (the frontend's SkillIds); the service turns
 * them into ObjectId refs.
 */
export type ProfilePutBody = {
  skills: string[];
  team_size_band: TeamSizeBand;
  duration: Duration;
  concurrent: number;
  budget_min: number;
  /** null = no maximum. */
  budget_max: number | null;
  notify: {
    on_match: boolean;
    only_strong_fit: boolean;
    include_signals: boolean;
  };
};

// The whole vocabulary — a profile can claim every skill, never more.
const MAX_SKILLS = SKILL_VOCABULARY.length;

function readEnum<T extends string>(
  src: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const value = required(readString(src, key, 32), key);
  if (!allowed.includes(value as T)) {
    throw new HttpError(400, `"${key}" must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

function readSkills(src: Record<string, unknown>): string[] {
  const value = src.skills;
  if (!Array.isArray(value)) throw new HttpError(400, '"skills" must be an array');
  if (value.length > MAX_SKILLS) {
    throw new HttpError(400, `"skills" must have ${MAX_SKILLS} entries or fewer`);
  }

  const slugs = value.map((entry) => {
    if (typeof entry !== "string" || !/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(entry)) {
      throw new HttpError(400, '"skills" must be a list of skill ids');
    }
    return entry;
  });

  // Order is the reader's pick order; keep it, drop repeats.
  return [...new Set(slugs)];
}

/** `budget_max` is the one field where null is a value, not "not sent". */
function readBudgetMax(src: Record<string, unknown>): number | null {
  if (!("budget_max" in src)) throw new HttpError(400, '"budget_max" is required');
  if (src.budget_max === null) return null;
  return required(readNumber(src, "budget_max", 0), "budget_max");
}

export function parseProfilePut(body: unknown): ProfilePutBody {
  const src = asObject(body);
  const notify = asObject(src.notify ?? null);

  const concurrent = required(readNumber(src, "concurrent", 1), "concurrent");
  if (!Number.isInteger(concurrent) || concurrent > 50) {
    throw new HttpError(400, '"concurrent" must be a whole number from 1 to 50');
  }

  const parsed: ProfilePutBody = {
    skills: readSkills(src),
    team_size_band: readEnum(src, "team_size_band", TEAM_SIZE_BANDS),
    duration: readEnum(src, "duration", DURATIONS),
    concurrent,
    budget_min: required(readNumber(src, "budget_min", 0), "budget_min"),
    budget_max: readBudgetMax(src),
    notify: {
      on_match: required(readBoolean(notify, "on_match"), "notify.on_match"),
      only_strong_fit: required(readBoolean(notify, "only_strong_fit"), "notify.only_strong_fit"),
      include_signals: required(readBoolean(notify, "include_signals"), "notify.include_signals"),
    },
  };

  // A range that excludes everything is a mistake worth naming, not storing.
  if (parsed.budget_max !== null && parsed.budget_min > parsed.budget_max) {
    throw new HttpError(400, '"budget_min" must not exceed "budget_max"');
  }

  return parsed;
}
