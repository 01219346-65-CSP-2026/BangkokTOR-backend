import { describe, expect, test } from "bun:test";
import { STRONG_FIT, matchMessage, matchTorToUsers, type MatchTor, type MatchUser } from "./match.ts";

// SPEC for Part A (SCRUM-75) — who hears about a new TOR.
// Run with:   bun test src/modules/match

const NOW = new Date("2026-10-10T05:00:00Z");

function tor(over: Partial<MatchTor> = {}): MatchTor {
  return {
    id: "tor1",
    projectName: "จ้างพัฒนาระบบบริการประชาชน",
    budget: 2_000_000,
    requiredSkills: ["react", "nodejs", "postgresql", "docker"],
    methodId: "eBidding",
    biddingStage: "invitation",
    bidClosesAt: new Date("2026-10-30T00:00:00Z"),
    ...over,
  };
}

function user(id: string, skills: string[], over: Partial<MatchUser> = {}): MatchUser {
  return {
    id,
    skills,
    budgetMin: null,
    budgetMax: null,
    notify: { onMatch: true, onlyStrongFit: false },
    ...over,
  };
}

describe("step A1: matchMessage", () => {
  test("says what matched, in numbers, and nothing else", () => {
    expect(matchMessage(75, 3, 4)).toBe("ตรงกับทักษะของคุณ 3 จาก 4 รายการ (75%)");
  });
});

describe("step A2: matchTorToUsers — the fit rule", () => {
  test("fit = share of the TOR's skills the reader has; 40+ notifies", () => {
    const out = matchTorToUsers(tor(), [user("u1", ["react", "nodejs"])], NOW); // 2/4 = 50
    expect(out).toEqual([
      { userId: "u1", torId: "tor1", fitScore: 50, title: "จ้างพัฒนาระบบบริการประชาชน", message: matchMessage(50, 2, 4) },
    ]);
  });

  test("below 40 is not a match", () => {
    expect(matchTorToUsers(tor(), [user("u1", ["react"])], NOW)).toEqual([]); // 25
  });

  test(`"only strong fit" readers need ${STRONG_FIT}+`, () => {
    const strongOnly = { notify: { onMatch: true, onlyStrongFit: true } };
    expect(matchTorToUsers(tor(), [user("u1", ["react", "nodejs"], strongOnly)], NOW)).toEqual([]); // 50
    expect(matchTorToUsers(tor(), [user("u2", ["react", "nodejs", "docker"], strongOnly)], NOW)).toHaveLength(1); // 75
  });

  test("a duplicated skill on the profile counts once", () => {
    expect(matchTorToUsers(tor(), [user("u1", ["react", "react", "react"])], NOW)).toEqual([]); // still 25
  });

  test("a TOR with no tagged skills matches nobody — 'can't tell' is not 'fits'", () => {
    expect(matchTorToUsers(tor({ requiredSkills: [] }), [user("u1", ["react"])], NOW)).toEqual([]);
  });

  test("best fit first, ties by user id", () => {
    const out = matchTorToUsers(
      tor(),
      [user("b", ["react", "nodejs"]), user("c", ["react", "nodejs", "docker", "postgresql"]), user("a", ["react", "docker"])],
      NOW,
    );
    expect(out.map((m) => [m.userId, m.fitScore])).toEqual([
      ["c", 100],
      ["a", 50],
      ["b", 50],
    ]);
  });
});

describe("step A3: matchTorToUsers — who opted out, what's out of range", () => {
  test("notify.onMatch off → never notified, whatever the fit", () => {
    const off = { notify: { onMatch: false, onlyStrongFit: false } };
    expect(matchTorToUsers(tor(), [user("u1", ["react", "nodejs", "postgresql", "docker"], off)], NOW)).toEqual([]);
  });

  test("budget outside the reader's range → no match; null max means no ceiling", () => {
    const skills = ["react", "nodejs"];
    expect(matchTorToUsers(tor(), [user("u1", skills, { budgetMin: 5_000_000 })], NOW)).toEqual([]);
    expect(matchTorToUsers(tor(), [user("u2", skills, { budgetMax: 1_000_000 })], NOW)).toEqual([]);
    expect(matchTorToUsers(tor(), [user("u3", skills, { budgetMin: 1_000_000, budgetMax: null })], NOW)).toHaveLength(1);
  });

  test("a TOR with no budget is not filtered out by budget", () => {
    expect(matchTorToUsers(tor({ budget: null }), [user("u1", ["react", "nodejs"], { budgetMax: 1 })], NOW)).toHaveLength(1);
  });
});

describe("step A4: matchTorToUsers — only TORs a team can still bid on", () => {
  test("closed tenders notify nobody: direct award, past deadline, awarded", () => {
    const fits = [user("u1", ["react", "nodejs"])];
    expect(matchTorToUsers(tor({ methodId: "specific" }), fits, NOW)).toEqual([]);
    expect(matchTorToUsers(tor({ bidClosesAt: new Date("2026-10-01T00:00:00Z") }), fits, NOW)).toEqual([]);
    expect(matchTorToUsers(tor({ biddingStage: "awarded" }), fits, NOW)).toEqual([]);
  });

  test("upcoming (TOR or purchase-report stage) is worth knowing about", () => {
    expect(matchTorToUsers(tor({ biddingStage: "tor", bidClosesAt: null }), [user("u1", ["react", "nodejs"])], NOW)).toHaveLength(1);
  });
});
