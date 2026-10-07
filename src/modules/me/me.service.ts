import { Types } from "mongoose";
import { HttpError } from "../../middleware/errors.ts";
import { UserModel } from "../user/user.model.ts";
import { TechstackModel } from "../techstack/techstack.model.ts";
import type { Duration, ProfilePutBody, TeamSizeBand } from "./me.validation.ts";
import type { WorkTypeId } from "../../lib/classify/workType.ts";

/** What GET and PUT /api/me/profile return. The frontend maps it in src/api/profile.ts. */
export type ProfileJSON = Omit<ProfilePutBody, "work_types"> & {
  work_types: WorkTypeId[];
  updated_at: string;
};

type StoredProfile = {
  budget_min?: number | null;
  budget_max?: number | null;
  team_size_band?: TeamSizeBand | null;
  duration?: Duration | null;
  concurrent?: number | null;
  work_types?: WorkTypeId[] | null;
  notify?: { on_match?: boolean; only_strong_fit?: boolean; include_signals?: boolean } | null;
  updated_at?: Date | null;
  tech_stacks?: {
    tech_stack_id?: Types.ObjectId | { _id: Types.ObjectId; slug?: string | null } | null;
    years_experience?: number | null;
  }[];
};

function notFound(userId: string): HttpError {
  return new HttpError(404, `User not found: ${userId}`);
}

/**
 * The signed-in user's skill profile, or null if they have never saved one —
 * which is how the frontend tells a new account from a returning one.
 */
export async function getProfile(userId: string): Promise<ProfileJSON | null> {
  const user = await UserModel.findById(userId, { profile: 1 })
    .populate<{ profile: StoredProfile }>({
      path: "profile.tech_stacks.tech_stack_id",
      select: { slug: 1 },
    })
    .lean<{ profile?: StoredProfile }>()
    .exec();

  if (!user) throw notFound(userId);

  const profile = user.profile;
  if (!profile?.updated_at) return null;

  // A tech stack an admin deleted, or one with no slug, simply drops out —
  // the wizard has no chip to render it as.
  const skills = (profile.tech_stacks ?? []).flatMap((row) => {
    const ref = row.tech_stack_id;
    return ref && "slug" in ref && ref.slug ? [ref.slug] : [];
  });

  return {
    skills,
    team_size_band: profile.team_size_band ?? "small",
    duration: profile.duration ?? "medium",
    concurrent: profile.concurrent ?? 1,
    budget_min: profile.budget_min ?? 0,
    budget_max: profile.budget_max ?? null,
    work_types: profile.work_types ?? [],
    notify: {
      on_match: profile.notify?.on_match ?? true,
      only_strong_fit: profile.notify?.only_strong_fit ?? true,
      include_signals: profile.notify?.include_signals ?? false,
    },
    updated_at: profile.updated_at.toISOString(),
  };
}

export async function putProfile(userId: string, input: ProfilePutBody): Promise<ProfileJSON> {
  const stacks = await TechstackModel.find({ slug: { $in: input.skills } }, { slug: 1 })
    .lean<{ _id: Types.ObjectId; slug: string }[]>()
    .exec();

  const idBySlug = new Map(stacks.map((s) => [s.slug, s._id]));
  const unknown = input.skills.filter((slug) => !idBySlug.has(slug));
  if (unknown.length > 0) {
    throw new HttpError(400, `Unknown skills: ${unknown.join(", ")}`);
  }

  // Years of experience are not edited by the wizard, but may have been set
  // through PATCH /api/user/:id. Keep them for skills that stay selected.
  const current = await UserModel.findById(userId, { "profile.tech_stacks": 1 })
    .lean<{ profile?: StoredProfile }>()
    .exec();
  if (!current) throw notFound(userId);

  const yearsById = new Map<string, number>();
  for (const row of current.profile?.tech_stacks ?? []) {
    if (row.tech_stack_id && typeof row.years_experience === "number") {
      yearsById.set(row.tech_stack_id.toString(), row.years_experience);
    }
  }

  const techStacks = input.skills.map((slug) => {
    const id = idBySlug.get(slug)!;
    const years = yearsById.get(id.toString());
    return years === undefined
      ? { tech_stack_id: id }
      : { tech_stack_id: id, years_experience: years };
  });

  // Dotted paths, not `profile: {...}`: replacing the subdocument would wipe
  // `description` and `team_size`, which this endpoint does not own.
  await UserModel.updateOne(
    { _id: userId },
    {
      $set: {
        "profile.tech_stacks": techStacks,
        "profile.team_size_band": input.team_size_band,
        "profile.duration": input.duration,
        "profile.concurrent": input.concurrent,
        "profile.budget_min": input.budget_min,
        "profile.budget_max": input.budget_max,
        "profile.notify": input.notify,
        "profile.updated_at": new Date(),
        ...(input.work_types !== undefined && { "profile.work_types": input.work_types }),
      },
    },
    { runValidators: true },
  ).exec();

  const saved = await getProfile(userId);
  if (!saved) throw notFound(userId);
  return saved;
}
