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
  return `ตรงกับทักษะของคุณ ${matched} จาก ${required} รายการ (${fit}%)` 
}

export function matchTorToUsers(tor: MatchTor, users: MatchUser[], now: Date = new Date()): MatchResult[] {
  // TODO(A2–A4). In this order, per LEARNING-A-ingest.md:


  let matchedResult = [];

  // TOR level: no requiredSkills → []; biddingStatus(tor, now) === "closed" → []
  if (!tor.requiredSkills || biddingStatus(tor, now) == "closed") return [];
  //  - per user: notify.onMatch off → skip; budget outside [budgetMin, budgetMax] → skip
  //    (only when tor.budget is known; a null bound means "no limit")
  for (let user of users) {
    if (!user.notify.onMatch) continue;
    if (tor.budget) {
      if (user.budgetMin !== null && user.budgetMin > tor.budget) continue;
      if (user.budgetMax !== null && user.budgetMax < tor.budget) continue;
    }

    //  - matched = DISTINCT profile skills found in tor.requiredSkills (a Set) 
    let matched = [... new Set(user.skills)].filter(e => tor.requiredSkills.includes(e));
    //  - fit = fitScore(matched, required); below the threshold → skip
    let fit = fitScore(matched.length, tor.requiredSkills.length) || 0;
    if (fit >= STRONG_FIT && user.notify.onlyStrongFit) {
      matchedResult.push({
        "userId": user.id,
        "torId": tor.id,
        "fitScore": fit,
        "title": tor.projectName,
        "message": matchMessage(fit, matched.length, tor.requiredSkills.length)
      })
    } else if (fit >= REACHABLE_MIN_FIT && !user.notify.onlyStrongFit) {
      matchedResult.push({
        "userId": user.id,
        "torId": tor.id,
        "fitScore": fit,
        "title": tor.projectName,
        "message": matchMessage(fit, matched.length, tor.requiredSkills.length)
      })
    }
    //    (STRONG_FIT when onlyStrongFit, else REACHABLE_MIN_FIT)
    //  - sort: fitScore desc, then userId asc
  }
  const sortedMatchedResult = [...matchedResult].sort((a, b) => 
                              (b.fitScore - a.fitScore) || a.userId.localeCompare(b.userId)
                          )
  return sortedMatchedResult
}
