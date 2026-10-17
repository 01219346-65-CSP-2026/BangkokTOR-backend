import { describe, expect, test } from "bun:test";
import { amountFit, matchBudget, sameAgency, titleSimilarity, type MatchLine, type MatchTor } from "./budget.match.ts";

const PORTAL: MatchLine = {
  id: "L1",
  agency: "สำนักดิจิทัลกรุงเทพมหานคร",
  description: "ค่าใช้จ่ายในการพัฒนาระบบรวมศูนย์การให้บริการประชาชน (BMA e-Service Smart Portal)",
  projectTitle: "โครงการพัฒนาระบบรวมศูนย์การให้บริการประชาชน (BMA e-Service Smart Portal)",
  projectTotal: 26_750_000,
  amount: 12_840_000,
};

const tor = (over: Partial<MatchTor> = {}): MatchTor => ({
  id: "T1",
  title: "ประกวดราคาจ้างพัฒนาระบบรวมศูนย์การให้บริการประชาชน (BMA e-Service Smart Portal) ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  agency: "สำนักดิจิทัลกรุงเทพมหานคร",
  department: null,
  budget: 12_800_000,
  announcedAt: new Date("2026-12-01T03:00:00Z"),
  ...over,
});

describe("sameAgency", () => {
  test("equal names, spacing aside", () => {
    expect(sameAgency("สำนักดิจิทัลกรุงเทพมหานคร", { agency: "สำนัก ดิจิทัลกรุงเทพมหานคร", department: null })).toBe(true);
  });
  test("the unit named in a national row's department", () => {
    expect(
      sameAgency("สำนักปลัดกรุงเทพมหานคร", { agency: "กรุงเทพมหานคร", department: "สำนักงานประชาสัมพันธ์  สำนักปลัดกรุงเทพมหานคร" }),
    ).toBe(true);
  });
  test("another agency, or the bare word กรุงเทพมหานคร", () => {
    expect(sameAgency("สำนักอนามัย", { agency: "สำนักดิจิทัลกรุงเทพมหานคร", department: null })).toBe(false);
    expect(sameAgency("สำนักดิจิทัลกรุงเทพมหานคร", { agency: "กรุงเทพมหานคร", department: null })).toBe(false);
  });
});

describe("titleSimilarity", () => {
  test("the same project in budget wording and TOR wording", () => {
    expect(titleSimilarity(PORTAL.projectTitle!, tor().title)).toBeGreaterThan(0.7);
  });
  test("two unrelated systems stay apart despite shared filler words", () => {
    expect(titleSimilarity("ค่าใช้จ่ายระบบบริหารจัดการจองคิวกลางของกรุงเทพมหานคร (BMA Q)", tor().title)).toBeLessThan(0.3);
  });
});

describe("amountFit", () => {
  test("at or just under the appropriation fits; over it does not", () => {
    expect(amountFit(12_840_000, PORTAL)).toBe(1);
    expect(amountFit(9_630_000, PORTAL)).toBeCloseTo(0.5, 1);
    expect(amountFit(30_000_000, PORTAL)).toBe(0); // over the line and the project total
    expect(amountFit(15_000_000, { amount: 12_840_000, projectTotal: null })).toBe(0);
  });
  test("a TOR for the whole multi-year project fits its total", () => {
    expect(amountFit(26_750_000, PORTAL)).toBe(1);
  });
  test("no budget on the TOR: neutral", () => {
    expect(amountFit(null, PORTAL)).toBe(0.5);
  });
});

describe("matchBudget", () => {
  test("the matching TOR spends the line, capped at the line's amount", () => {
    const m = matchBudget([PORTAL], [tor({ budget: 26_750_000 })]).get("L1")!;
    expect(m.tors.map((t) => t.id)).toEqual(["T1"]);
    expect(m.tenderedAmount).toBe(12_840_000);
    expect(m.firstAnnouncedAt?.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });

  test("another agency's TOR with the same title does not", () => {
    expect(matchBudget([PORTAL], [tor({ agency: "สำนักอนามัย" })]).size).toBe(0);
  });

  test("each TOR spends one line — the better fit", () => {
    const twin: MatchLine = { ...PORTAL, id: "L2", projectTitle: null, projectTotal: null, amount: 40_000_000 };
    const result = matchBudget([twin, PORTAL], [tor()]);
    expect([...result.keys()]).toEqual(["L1"]);
  });

  test("a line split into lots: several TORs add up", () => {
    const result = matchBudget([PORTAL], [tor({ id: "T1", budget: 5_000_000 }), tor({ id: "T2", budget: 4_000_000 })]);
    expect(result.get("L1")!.tenderedAmount).toBe(9_000_000);
  });

  test("a TOR with no budget recorded counts as the whole line", () => {
    expect(matchBudget([PORTAL], [tor({ budget: null })]).get("L1")!.tenderedAmount).toBe(12_840_000);
  });
});
