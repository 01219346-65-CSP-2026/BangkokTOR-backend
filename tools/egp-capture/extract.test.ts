import { describe, expect, test } from "bun:test";
import "./extract.js";

const { extract, classify, isProjectId } = (globalThis as any).bktExtract as {
  extract: (text: string) => Array<{ projectId: string; title?: string; agency?: string; province?: string }>;
  classify: (url: string) => string | null;
  isProjectId: (v: unknown) => boolean;
};

describe("extract", () => {
  test("reads rows from a search response, with their details", () => {
    const body = JSON.stringify({
      validateCfTurnTile: true,
      data: { data: [
        { projectId: "69099316505", projectName: "ประกวดราคาจ้าง…ระบบ", deptSubName: "สำนักดิจิทัล", moiName: "กรุงเทพมหานคร", projectMoney: 7087000 },
        { projectId: 69099312832, projectName: "จ้างบำรุงรักษาระบบ" },
      ] },
    });
    expect(extract(body)).toEqual([
      { projectId: "69099316505", title: "ประกวดราคาจ้าง…ระบบ", agency: "สำนักดิจิทัล", province: "กรุงเทพมหานคร" },
      { projectId: "69099312832", title: "จ้างบำรุงรักษาระบบ", agency: undefined, province: undefined },
    ]);
  });

  test("finds ids in CSV text, de-duplicated", () => {
    const csv = "เลขที่โครงการ,ชื่อ,งบ\n69099316505,ระบบ A,7087000\n69099316505,ระบบ A,7087000\n69089343980,ระบบ B,5400000\n";
    expect(extract(csv).map((p) => p.projectId)).toEqual(["69099316505", "69089343980"]);
  });

  test("ignores numbers that are not project ids", () => {
    // 10 and 12 digits, a budget, a phone number, month 13.
    const text = "6909931650 690993165051 7087000.00 0812345678 0221234567 69139316505";
    expect(extract(text)).toEqual([]);
  });

  test("a failed Turnstile response captures nothing", () => {
    expect(extract(JSON.stringify({ validateCfTurnTile: false }))).toEqual([]);
  });
});

describe("classify", () => {
  test("only the search and its export", () => {
    const base = "https://process5.gprocurement.go.th/egp-oann10-service/pb/a-egp-allt-project/announcement";
    expect(classify(`${base}?announceType=W0&page=2`)).toBe("egp-search");
    expect(classify(`${base}/csv`)).toBe("egp-csv");
    expect(classify(`${base}/getProcurementDetail?projectId=69099316505`)).toBeNull();
  });

  test("isProjectId", () => {
    expect(isProjectId("69099316505")).toBe(true);
    expect(isProjectId("6909931650")).toBe(false);
  });
});
