import type { Types } from "mongoose";
import { TorModel } from "../tor/tor.model.ts";
import { UserModel } from "../user/user.model.ts";
import { NotificationModel } from "../notification/notification.model.ts";
import { matchTorToUsers, type MatchUser } from "./match.ts";

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
  // TODO(A5). id as a string; skills = the populated tech_stack_id.slug values,
  // skipping null refs and null slugs; budgets ?? null; notify defaults to
  // on_match TRUE and only_strong_fit TRUE — the same defaults as
  // me.service.ts getProfile, so matching and the wizard never disagree.
  void user;
  throw new Error("TODO(A5): toMatchUser");
}

/**
 * Match one TOR against every reader with a saved profile and write a
 * notification per match. Safe to run twice: the (user_id, tor_id) unique
 * index plus $setOnInsert means a second run changes nothing.
 * Returns how many NEW notifications were written.
 */
export async function notifyMatches(torId: Types.ObjectId | string, now: Date = new Date()): Promise<number> {
  // TODO(A6).
  //  1. TorModel.findById(torId, <the 6 fields MatchTor needs>).lean(); none → 0
  //  2. UserModel.find(users with a saved profile who haven't turned matches off)
  //       .populate({ path: "profile.tech_stacks.tech_stack_id", select: { slug: 1 } })
  //     — me.service.ts getProfile does the same populate; read it.
  //  3. run the pure matcher on <tor as MatchTor> and users.map(toMatchUser)
  //  4. NotificationModel.bulkWrite with one updateOne per match: filter on
  //     user_id + tor_id, and an upsert that only sets fields on INSERT
  //     (Mongo's "set on insert" operator — look it up) — title, message,
  //     fit_score, matched_at, and email_status pending (the contract)
  //  5. return result.upsertedCount (NEW rows only)
  void [torId, now, TorModel, UserModel, NotificationModel, matchTorToUsers];
  throw new Error("TODO(A6): notifyMatches");
}
