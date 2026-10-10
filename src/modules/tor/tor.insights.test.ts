import { describe, expect, test } from "bun:test";
import {
  BANGKOK,
  BUDGET_BANDS,
  TOP_AGENCIES,
  budgetBand,
  buildInsights,
  lastMonths,
  monthKey,
  share,
  type InsightRow,
} from "./tor.insights.ts";

// SPEC for feat/116 — the numbers behind the four dashboard graphs.
// Run with:   bun test src/modules/tor/tor.insights.test.ts
//
// Work top to bottom: the small helpers first, then buildInsights one graph
// at a time. Each describe() block is one step in LEARNING.md.

const NOW = new Date("2026-10-10T05:00:00Z"); // 12:00 in Bangkok

function row(over: Partial<InsightRow> = {}): InsightRow {
  return {
    methodId: "eBidding",
    budget: 1_000_000,
    province: BANGKOK,
    agency: "สำนักการระบายน้ำ",
    announcedAt: new Date("2026-09-15T03:00:00Z"),
    biddingStage: null,
    bidClosesAt: null,
    ...over,
  };
}

// The slides' shape in miniature: direct awards are most TORs but little
// money; the biddable methods are fewer and larger.
const CORPUS: InsightRow[] = [
  row({ methodId: "specific", budget: 100_000, agency: "A" }),
  row({ methodId: "specific", budget: 200_000, agency: "A" }),
  row({ methodId: "specific", budget: 300_000, agency: "B", province: "เชียงใหม่" }),
  row({ methodId: "eBidding", budget: 8_000_000, agency: "C" }),
  row({ methodId: "competitive", budget: 1_400_000, agency: "D", province: "ภูเก็ต" }),
];

describe("step 1: helpers", () => {
  test("share is a percent with one decimal, 0 when the whole is 0", () => {
    expect(share(1, 4)).toBe(25);
    expect(share(1, 3)).toBe(33.3);
    expect(share(2, 3)).toBe(66.7);
    expect(share(5, 0)).toBe(0);
  });

  test("budgetBand: lower bound inclusive, upper exclusive, null is unpriced", () => {
    expect(budgetBand(0)).toBe("under500k");
    expect(budgetBand(499_999)).toBe("under500k");
    expect(budgetBand(500_000)).toBe("500kTo5m");
    expect(budgetBand(4_999_999)).toBe("500kTo5m");
    expect(budgetBand(5_000_000)).toBe("5mTo50m");
    expect(budgetBand(50_000_000)).toBe("over50m");
    expect(budgetBand(null)).toBeNull();
  });

  test("monthKey reads the month in Bangkok time, not UTC", () => {
    expect(monthKey(new Date("2026-03-15T00:00:00Z"))).toBe("2026-03");
    // 31 Jan 20:00 UTC is already 1 Feb 03:00 in Bangkok.
    expect(monthKey(new Date("2026-01-31T20:00:00Z"))).toBe("2026-02");
  });

  test("lastMonths: twelve months ending with now's month, oldest first", () => {
    const months = lastMonths(NOW);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-11");
    expect(months.at(-1)).toBe("2026-10");
    // Crossing the year boundary keeps the zero padding.
    expect(lastMonths(new Date("2026-02-01T00:00:00Z"), 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });
});

describe("step 2: totals (the KPI row)", () => {
  test("counts, sums and the Bangkok share", () => {
    const { totals } = buildInsights(CORPUS, NOW);
    expect(totals.tors).toBe(5);
    expect(totals.provinces).toBe(3);
    expect(totals.budget).toBe(10_000_000);
    expect(totals.biddableTors).toBe(2);
    expect(totals.biddableBudget).toBe(9_400_000);
    expect(totals.bangkokTors).toBe(3);
    expect(totals.bangkokShare).toBe(60);
  });

  test("a missing budget counts as a TOR but adds nothing to the money", () => {
    const { totals } = buildInsights([row({ budget: null }), row({ budget: 2_000_000 })], NOW);
    expect(totals.tors).toBe(2);
    expect(totals.budget).toBe(2_000_000);
  });

  test("a missing province is not a province", () => {
    const { totals } = buildInsights([row({ province: null }), row({ province: "" }), row()], NOW);
    expect(totals.provinces).toBe(1);
  });

  test("openNow agrees with tor.bidding.ts: invitation stage, deadline not passed, not a direct award", () => {
    const rows = [
      row({ biddingStage: "invitation", bidClosesAt: new Date("2026-10-20T00:00:00Z") }), // open
      row({ biddingStage: "invitation", bidClosesAt: null }), // open: deadline not read yet
      row({ biddingStage: "invitation", bidClosesAt: new Date("2026-10-01T00:00:00Z") }), // passed
      row({ biddingStage: "invitation", methodId: "specific" }), // direct award: never open
      row({ biddingStage: "tor" }), // upcoming, not open
    ];
    expect(buildInsights(rows, NOW).totals.openNow).toBe(2);
  });

  test("no rows is a valid answer, not a crash", () => {
    const empty = buildInsights([], NOW);
    expect(empty.totals.tors).toBe(0);
    expect(empty.totals.bangkokShare).toBe(0);
    expect(empty.byMonth).toHaveLength(12);
    expect(empty.budgetBands).toHaveLength(BUDGET_BANDS.length);
  });
});

describe("step 3: graph 1 — method mix by number and by budget", () => {
  test("fixed order specific → eBidding → competitive, with both shares", () => {
    const { byMethod } = buildInsights(CORPUS, NOW);
    expect(byMethod).toEqual([
      { method: "specific", tors: 3, budget: 600_000, torShare: 60, budgetShare: 6 },
      { method: "eBidding", tors: 1, budget: 8_000_000, torShare: 20, budgetShare: 80 },
      { method: "competitive", tors: 1, budget: 1_400_000, torShare: 20, budgetShare: 14 },
    ]);
  });

  test("a method with no TORs still appears, at zero", () => {
    const { byMethod } = buildInsights([row({ methodId: "eBidding" })], NOW);
    expect(byMethod.map((m) => [m.method, m.tors])).toEqual([
      ["specific", 0],
      ["eBidding", 1],
      ["competitive", 0],
    ]);
  });

  test("an unrecognised or missing method is 'unknown', listed last and only when present", () => {
    const { byMethod } = buildInsights([row({ methodId: null }), row({ methodId: "weird" }), row()], NOW);
    expect(byMethod.at(-1)).toMatchObject({ method: "unknown", tors: 2 });
  });
});

describe("step 4: graph 2 — budget bands", () => {
  test("every band, in order, with how many of each are biddable", () => {
    const { budgetBands, unpricedTors } = buildInsights([...CORPUS, row({ budget: null })], NOW);
    expect(budgetBands).toEqual([
      { band: "under500k", tors: 3, biddable: 0 },
      { band: "500kTo5m", tors: 1, biddable: 1 },
      { band: "5mTo50m", tors: 1, biddable: 1 },
      { band: "over50m", tors: 0, biddable: 0 },
    ]);
    expect(unpricedTors).toBe(1);
  });
});

describe("step 5: graph 3 — top agencies by biddable budget", () => {
  test("biddable TORs only, most money first", () => {
    const { topAgencies } = buildInsights(CORPUS, NOW);
    expect(topAgencies).toEqual([
      { agency: "C", tors: 1, budget: 8_000_000 },
      { agency: "D", tors: 1, budget: 1_400_000 },
    ]);
  });

  test("an agency's TORs add up; ties break on count, then name", () => {
    const rows = [
      row({ agency: "Z", budget: 1_000_000 }),
      row({ agency: "Y", budget: 500_000 }),
      row({ agency: "Y", budget: 500_000 }),
      row({ agency: "X", budget: 1_000_000 }),
    ];
    expect(buildInsights(rows, NOW).topAgencies.map((a) => a.agency)).toEqual(["Y", "X", "Z"]);
  });

  test(`at most ${TOP_AGENCIES}, and a blank agency is skipped`, () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ agency: `agency-${i}`, budget: 1_000_000 + i }));
    rows.push(row({ agency: "", budget: 99_000_000 }), row({ agency: null, budget: 99_000_000 }));
    const { topAgencies } = buildInsights(rows, NOW);
    expect(topAgencies).toHaveLength(TOP_AGENCIES);
    expect(topAgencies[0]!.agency).toBe("agency-11");
  });
});

describe("step 6: graph 4 — TORs announced per month", () => {
  test("twelve zero-filled months, rows outside the window ignored", () => {
    const rows = [
      row({ announcedAt: new Date("2026-09-15T03:00:00Z") }),
      row({ announcedAt: new Date("2026-09-20T03:00:00Z"), methodId: "specific" }),
      row({ announcedAt: new Date("2026-10-01T03:00:00Z") }),
      row({ announcedAt: new Date("2024-01-01T03:00:00Z") }), // too old
      row({ announcedAt: null }),
    ];
    const { byMonth } = buildInsights(rows, NOW);
    expect(byMonth).toHaveLength(12);
    expect(byMonth.find((m) => m.month === "2026-09")).toEqual({ month: "2026-09", tors: 2, biddable: 1 });
    expect(byMonth.at(-1)).toEqual({ month: "2026-10", tors: 1, biddable: 1 });
    expect(byMonth[0]).toEqual({ month: "2025-11", tors: 0, biddable: 0 });
  });
});

describe("FR-19: the insights never carry a grade or a signal", () => {
  test("no grade, finding or signal key anywhere in the response", () => {
    const json = JSON.stringify(buildInsights(CORPUS, NOW));
    expect(json).not.toMatch(/grade|finding|signal|suspicious/i);
  });
});
