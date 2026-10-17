import { describe, expect, test } from "bun:test";
import type { LineMatch } from "./budget.match.ts";
import { buildBudgetInsights, buildTiming, displayTitle, fiscalMonths, type InsightLine } from "./budget.insights.ts";

const line = (id: string, over: Partial<InsightLine> = {}): InsightLine => ({
  id,
  agency: "สำนักดิจิทัลกรุงเทพมหานคร",
  description: `line ${id}`,
  projectTitle: null,
  projectTotal: null,
  amount: 1_000_000,
  workTypes: ["development"],
  ...over,
});

const matched = (lineId: string, tenderedAmount: number, at: string | null): [string, LineMatch] => [
  lineId,
  { lineId, tors: [{ id: `T-${lineId}`, budget: tenderedAmount, announcedAt: at ? new Date(at) : null, score: 0.9 }], tenderedAmount, firstAnnouncedAt: at ? new Date(at) : null },
];

const BASE = {
  year: 2570,
  status: "draft" as const,
  source: { dataset: "70-excel", url: "https://data.bangkok.go.th/dataset/70-excel", importedAt: new Date("2026-10-16T00:00:00Z") },
  coverage: { files: 60, skipped: ["70011 สำนักการแพทย์"] },
  lastYear: null,
};

describe("fiscalMonths", () => {
  test("2570 runs October 2026 to September 2027", () => {
    const months = fiscalMonths(2570);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-10");
    expect(months[11]).toBe("2027-09");
  });
});

test("displayTitle prefers the project's name and drops item numbering", () => {
  expect(displayTitle({ description: "(2) ค่าใช้จ่ายโครงการระบบ IP", projectTitle: null })).toBe("ค่าใช้จ่ายโครงการระบบ IP");
  expect(displayTitle({ description: "ค่าจ้าง…", projectTitle: "โครงการระบบ BMA Q" })).toBe("โครงการระบบ BMA Q");
});

describe("buildBudgetInsights", () => {
  const lines = [
    line("A", { amount: 12_000_000 }),
    line("B", { amount: 300_000, agency: "สำนักอนามัย" }),
    line("C", { amount: 5_000_000 }),
  ];
  const out = buildBudgetInsights({ ...BASE, lines, matches: new Map([matched("C", 4_000_000, "2026-11-10T03:00:00Z")]) });

  test("totals: budget, tendered, still to come", () => {
    expect(out.totals).toEqual({
      lines: 3,
      budget: 17_300_000,
      tenderedLines: 1,
      tenderedBudget: 4_000_000,
      toComeBudget: 13_300_000,
      tenderedShare: 23.1,
    });
  });

  test("agencies by budget size, with what has been tendered", () => {
    expect(out.agencies).toEqual([
      { agency: "สำนักดิจิทัลกรุงเทพมหานคร", lines: 2, budget: 17_000_000, tenderedBudget: 4_000_000 },
      { agency: "สำนักอนามัย", lines: 1, budget: 300_000, tenderedBudget: 0 },
    ]);
  });

  test("upcoming: no TOR yet, biggest first, with the likely method", () => {
    expect(out.upcoming.map((u) => [u.id, u.likelyMethod])).toEqual([
      ["A", "eBidding"],
      ["B", "specific"],
    ]);
    expect(out.upcomingTotal).toBe(2);
  });

  test("no last year → no timing", () => {
    expect(out.timing).toBeNull();
  });

  test("FR-19: no word that reads as blame", () => {
    expect(JSON.stringify(out)).not.toMatch(/unspent|late|overdue|underperform|suspicious|grade|signal/i);
  });
});

describe("buildTiming — last year's pace", () => {
  const lines = [line("A", { amount: 6_000_000 }), line("B", { amount: 4_000_000 }), line("C", { amount: 10_000_000 })];

  test("cumulative share of the year's budget by fiscal month", () => {
    const t = buildTiming(
      2569,
      lines,
      new Map([
        matched("A", 6_000_000, "2025-11-15T03:00:00Z"), // Nov
        matched("B", 4_000_000, "2026-02-01T03:00:00Z"), // Feb
      ]),
    );
    expect(t.months[0]).toEqual({ month: "2025-10", share: 0 });
    expect(t.months[1]).toEqual({ month: "2025-11", share: 30 });
    expect(t.months[4]).toEqual({ month: "2026-02", share: 50 });
    expect(t.months[11]).toEqual({ month: "2026-09", share: 50 });
    expect(t.matchedLines).toBe(2);
  });

  test("tendered before the year began counts in October; undated is left out", () => {
    const t = buildTiming(2569, lines, new Map([matched("A", 6_000_000, "2025-08-01T03:00:00Z"), matched("B", 4_000_000, null)]));
    expect(t.months[0]!.share).toBe(30);
    expect(t.months[11]!.share).toBe(30);
    expect(t.matchedLines).toBe(2);
  });

  test("months are Bangkok time: 30 Sep 18:00 UTC is already October", () => {
    const t = buildTiming(2569, lines, new Map([matched("A", 6_000_000, "2026-09-30T18:00:00Z")]));
    expect(t.months[11]!.share).toBe(0); // falls after September — into next year, not counted
  });
});
