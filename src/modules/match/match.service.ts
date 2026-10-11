import { Types } from "mongoose";
import { TorModel } from "../tor/tor.model.ts";
import { UserModel } from "../user/user.model.ts";
import { NotificationModel } from "../notification/notification.model.ts";
import { matchTorToUsers, type MatchTor, type MatchUser } from "./match.ts";

type StoredUser = {
  _id: Types.ObjectId;
  profile?: {
    budget_min?: number | null;
    budget_max?: number | null;
    notify?: { on_match?: boolean | null; only_strong_fit?: boolean | null } | null;
    tech_stacks?: Array<{ tech_stack_id?: { slug?: string | null } | null }>;
  };
};

/** A stored user in matching's shape. Defaults mirror me.service getProfile. */
export function toMatchUser(user: StoredUser): MatchUser {
  // skipping null refs and null slugs; budgets ?? null; notify defaults to
  // on_match TRUE and only_strong_fit TRUE — the same defaults as
  // me.service.ts getProfile, so matching and the wizard never disagree.
  return {
    id: String(user._id),
    skills: user.profile?.tech_stacks?.map(techstack => techstack.tech_stack_id?.slug).filter((x): x is string => x != null) ?? [],
    budgetMin: user.profile?.budget_min ?? null,
    budgetMax: user.profile?.budget_max ?? null,
    notify: { 
      onMatch: user.profile?.notify?.on_match ?? true,
      onlyStrongFit: user.profile?.notify?.only_strong_fit ?? true,
    }
  }
}

/**
 * Match one TOR against every reader with a saved profile and write a
 * notification per match. Safe to run twice: the (user_id, tor_id) unique
 * index plus $setOnInsert means a second run changes nothing.
 * Returns how many NEW notifications were written.
 */
export async function notifyMatches(torId: Types.ObjectId | string, now: Date = new Date()): Promise<number> {
  const tor = await TorModel.findById(torId, {
    projectName: 1, budget: 1, requiredSkills: 1, methodId: 1, biddingStage: 1, bidClosesAt: 1,
  })
    .lean<{
      _id: Types.ObjectId;
      projectName: string;
      budget?: number | null;
      requiredSkills?: Array<{ slug: string }>;
      methodId?: string | null;
      biddingStage?: string | null;
      bidClosesAt?: Date | null;
    }>()
    .exec();
  if (!tor) return 0;

  const matchTor: MatchTor = {
    id: String(tor._id),
    projectName: tor.projectName,
    budget: tor.budget ?? null,
    // keyword and llm taggers can both tag the same slug
    requiredSkills: [...new Set((tor.requiredSkills ?? []).map((s) => s.slug))],
    methodId: tor.methodId ?? null,
    biddingStage: tor.biddingStage ?? null,
    bidClosesAt: tor.bidClosesAt ?? null,
  };

  // updated_at marks a saved profile. on_match unset means on (getProfile's
  // default), so filter $ne false rather than === true.
  const users = await UserModel.find(
    { "profile.updated_at": { $exists: true }, "profile.notify.on_match": { $ne: false } },
    { profile: 1 },
  )
    .populate({ path: "profile.tech_stacks.tech_stack_id", select: { slug: 1 } })
    .lean<StoredUser[]>()
    .exec();

  const matches = matchTorToUsers(matchTor, users.map(toMatchUser), now);
  if (matches.length === 0) return 0;

  const result = await NotificationModel.bulkWrite(
    matches.map((m) => ({
      updateOne: {
        filter: { user_id: new Types.ObjectId(m.userId), tor_id: tor._id },
        update: {
          $setOnInsert: {
            title: m.title,
            message: m.message,
            fit_score: m.fitScore,
            matched_at: now,
            email_status: "pending",
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return result.upsertedCount;
}
