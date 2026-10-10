import { biddingStatus } from "../tor/tor.bidding.ts";
import { fitScore, REACHABLE_MIN_FIT } from "../tor/tor.preview.ts";

// Part A (SCRUM-75): which readers should hear about a newly ingested TOR.
//
// Pure, like tor.preview.ts: one TOR and the candidate readers in, the
// notifications to write out. No database, so every rule is a unit test.

/** The TOR, as much of it as matching reads. */
export type MatchTor = {
  id: string;
  projectName: string;
  budget: number | null;
  requiredSkills: string[];
  methodId: string | null;
  biddingStage: string | null;
  bidClosesAt: Date | null;
};

/** A reader, as much of their profile as matching reads. */
export type MatchUser = {
  id: string;
  skills: string[];
  budgetMin: number | null;
  /** Null means "no maximum". */
  budgetMax: number | null;
  notify: { onMatch: boolean; onlyStrongFit: boolean };
};

export type MatchResult = {
  userId: string;
  torId: string;
  fitScore: number;
  title: string;
  message: string;
};

/** The /tor filter's "strong" band starts here (FIT_RANGES in tor.service.ts). */
export const STRONG_FIT = 70;

/** The notification body. Neutral: what matched, never a judgement (FR-19). */
export function matchMessage(fit: number, matched: number, required: number): string {
  // TODO(A1). Exactly: ตรงกับทักษะของคุณ <matched> จาก <required> รายการ (<fit>%)
  throw new Error("TODO(A1): matchMessage");
}

export function matchTorToUsers(tor: MatchTor, users: MatchUser[], now: Date = new Date()): MatchResult[] {
  // TODO(A2–A4). In this order, per LEARNING-A-ingest.md:
  //  - TOR level: no requiredSkills → []; biddingStatus(tor, now) === "closed" → []
  //  - per user: notify.onMatch off → skip; budget outside [budgetMin, budgetMax] → skip
  //    (only when tor.budget is known; a null bound means "no limit")
  //  - matched = DISTINCT profile skills found in tor.requiredSkills (a Set)
  //  - fit = fitScore(matched, required); below the threshold → skip
  //    (STRONG_FIT when onlyStrongFit, else REACHABLE_MIN_FIT)
  //  - sort: fitScore desc, then userId asc
  void [tor, users, now, biddingStatus, fitScore, REACHABLE_MIN_FIT];
  throw new Error("TODO(A2): matchTorToUsers");
}
