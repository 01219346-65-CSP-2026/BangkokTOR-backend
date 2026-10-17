import { describe, expect, test } from "bun:test";
import type { Sheet } from "../../xlsx/readXlsx.ts";
import { columnIndex, detailSheet, parseBudgetWorkbook } from "./parse.ts";
import { classifyBudgetLine, lineText } from "./classify.ts";

// Rows copied from the 2570 draft workbooks (data.bangkok.go.th 70-excel):
// 70026 สำนักดิจิทัล (descriptions in D, amounts in G), 70031 เขตปทุมวัน (E/H)
// and 70059 เขตคลองเตย (F/L) — the column drift the parser must survive.

const DIGITAL: Sheet = {
  name: "รายละเอียด",
  rows: [
    { B: "สำนักดิจิทัลกรุงเทพมหานคร" },
    { B: "งบประมาณตามโครงสร้างผลผลิต", F: "845320670", H: "บาท" },
    { B: "ผลผลิตรายจ่ายบุคลากร", F: "73059800", H: "บาท" },
    { B: "งบบุคลากร", E: "73059800", G: "บาท" },
    { C: "01101-1", D: "(1) เงินเดือน", G: "57921900", H: "บาท" },
    { B: "ผลผลิตระบบเทคโนโลยีสารสนเทศและการสื่อสาร", F: "768296669", H: "บาท" },
    { B: "1. งบดำเนินงาน", E: "559336400", G: "บาท" },
    { B: "รายการผูกพัน" },
    { B: "0103002-69-01", D: "โครงการจ้างใช้บริการงานบริการระบบบริหารจัดการฐานข้อมูล" },
    { D: "วัตถุประสงค์" },
    { D: "- เพื่อจัดหาระบบบริหารจัดการฐานข้อมูลสำหรับระบบสารสนเทศ" },
    { C: "03299-3", D: "ค่าจ้างใช้บริการงานบริการระบบบริหาร\nจัดการฐานข้อมูล", G: "29453000", H: "บาท" },
    { E: "เงิน", G: "เงินนอก" },
    { D: "งบประมาณทั้งสิ้น", E: "114000000", G: "-", H: "บาท" },
    { D: "ปี 2570 ตั้งงบประมาณ", E: "29453000", G: "-", H: "บาท" },
    { B: "2. งบรายจ่ายอื่น", E: "208728269", G: "บาท" },
    { C: "07199-8", D: "(1) ค่าใช้จ่ายในการจัดหาระบบคอมพิวเตอร์" },
    { D: "สำหรับปรับปรุงและทดแทนระบบทะเบียน" },
    { D: "ราษฎร และบัตรประจำตัวประชาชน", G: "36275860", H: "บาท" },
    { C: "07199-9", D: "(2) ค่าใช้จ่ายโครงการระบบบริหารจัดการ" },
    { B: "2. งบลงทุน", E: "232000", G: "บาท" }, // structure before an amount: 07199-9 is lost
  ],
};

const PATHUMWAN: Sheet = {
  name: "รายละเอียดตามงบรายจ่าย",
  rows: [
    { A: "สำนักงานเขตปทุมวัน" },
    { B: "2. งบลงทุน", G: "57000", H: "บาท" },
    { C: "05105-1", E: "เครื่องคอมพิวเตอร์สำหรับงานสำนักงาน" },
    { E: "(OEM) ที่มีลิขสิทธิ์ที่ถูกต้องตามกฎหมาย 2 เครื่อง", H: "57000", I: "บาท" },
  ],
};

const KHLONGTOEI: Sheet = {
  name: "6 รายละเอียด (2)",
  rows: [
    { A: "สำนักงานเขตคลองเตย" },
    { A: "โครงการส่งเสริมกิจกรรมสโมสรกีฬาและลานกีฬา", L: "1439800", M: "บาท" },
    { B: "งบรายจ่ายอื่น", K: "1439800", L: "บาท" },
    { C: "07199-1", F: "ค่าใช้จ่ายในการส่งเสริมกิจกรรมสโมสรกีฬาและลานกีฬา", L: "1439800", M: "บาท" },
  ],
};

describe("detailSheet", () => {
  test("the sheet with the most line codes, whatever it is called", () => {
    const intro: Sheet = { name: "คำนำ", rows: [{ A: "สำนักดิจิทัล" }] };
    expect(detailSheet([intro, KHLONGTOEI])?.name).toBe("6 รายละเอียด (2)");
    expect(detailSheet([intro])).toBeNull();
  });
});

describe("parseBudgetWorkbook — 70026 สำนักดิจิทัล", () => {
  const wb = parseBudgetWorkbook([DIGITAL]);

  test("agency from the first row", () => {
    expect(wb.agency).toBe("สำนักดิจิทัลกรุงเทพมหานคร");
  });

  test("lines, not subtotals: three lines with amounts, in order", () => {
    expect(wb.lines.map((l) => [l.seq, l.lineCode, l.amount])).toEqual([
      [0, "01101-1", 57_921_900],
      [1, "03299-3", 29_453_000],
      [2, "07199-8", 36_275_860],
    ]);
  });

  test("output and budget type carried onto each line", () => {
    expect(wb.lines[0]).toMatchObject({ output: "รายจ่ายบุคลากร", budgetType: "personnel", expenseCode: "01101" });
    expect(wb.lines[2]).toMatchObject({ output: "ระบบเทคโนโลยีสารสนเทศและการสื่อสาร", budgetType: "other" });
  });

  test("a multi-row description is joined", () => {
    expect(wb.lines[2]!.description).toBe(
      "(1) ค่าใช้จ่ายในการจัดหาระบบคอมพิวเตอร์สำหรับปรับปรุงและทดแทนระบบทะเบียนราษฎร และบัตรประจำตัวประชาชน",
    );
  });

  test("a project line: code, title, details and the project's total", () => {
    expect(wb.lines[1]!.project).toEqual({
      code: "0103002-69-01",
      title: "โครงการจ้างใช้บริการงานบริการระบบบริหารจัดการฐานข้อมูล",
      details: "วัตถุประสงค์ - เพื่อจัดหาระบบบริหารจัดการฐานข้อมูลสำหรับระบบสารสนเทศ",
      total: 114_000_000,
    });
    expect(wb.lines[2]!.project).toBeNull();
  });

  test("a line cut off by structure before its amount is reported, not guessed", () => {
    expect(wb.unparsed).toEqual(["07199-9"]);
  });
});

describe("parseBudgetWorkbook — column drift", () => {
  test("70031: description in E, amount in H", () => {
    const wb = parseBudgetWorkbook([PATHUMWAN]);
    expect(wb.agency).toBe("สำนักงานเขตปทุมวัน");
    expect(wb.lines).toHaveLength(1);
    expect(wb.lines[0]).toMatchObject({ lineCode: "05105-1", amount: 57_000, budgetType: "investment" });
    expect(wb.lines[0]!.description).toContain("2 เครื่อง");
  });

  test("70059: description in F, amount in L, headings in A", () => {
    const wb = parseBudgetWorkbook([KHLONGTOEI]);
    expect(wb.lines.map((l) => [l.lineCode, l.amount, l.budgetType])).toEqual([["07199-1", 1_439_800, "other"]]);
  });
});

test("columnIndex", () => {
  expect([columnIndex("A"), columnIndex("D"), columnIndex("Z"), columnIndex("AA")]).toEqual([0, 3, 25, 26]);
});

describe("classifyBudgetLine — the TOR rule, with the budget guards", () => {
  const line = (description: string, over: Partial<Parameters<typeof classifyBudgetLine>[0]> = {}) =>
    classifyBudgetLine({ expenseCode: "07199", budgetType: "other", description, project: null, ...over });

  test("real software lines from 2570", () => {
    expect(line("ค่าใช้จ่ายในการพัฒนาระบบรวมศูนย์การให้บริการประชาชน (BMA e-Service Smart Portal)").isSoftware).toBe(true);
    expect(line("(1) โครงการพัฒนาระบบสารสนเทศเพื่อบริหารยุทธศาสตร์การพัฒนากรุงเทพมหานคร").workTypes).toContain("development");
  });

  test("an IT word only in the project's details still counts (BMA Q)", () => {
    const bmaQ = {
      code: "0103002-68-10",
      title: "โครงการระบบบริหารจัดการจองคิวกลางของกรุงเทพมหานคร (BMA Q)",
      details: "- มีระบบ Mobile Application ซึ่งรองรับทั้งระบบปฏิบัติการ iOS และ Android",
      total: 48_068_760,
    };
    expect(line("ค่าใช้จ่ายระบบบริหารจัดการจองคิวกลางของกรุงเทพมหานคร (BMA Q)", { project: bmaQ }).isSoftware).toBe(true);
  });

  test("not software: salaries, photocopiers, utility bills, a bus system", () => {
    expect(line("ค่าจ้างพัฒนาระบบสารสนเทศ", { expenseCode: "01101", budgetType: "personnel" }).isSoftware).toBe(false);
    expect(line("(4) เครื่องถ่ายเอกสาร ระบบดิจิทัล (ขาว-ดำ) ความเร็ว 30 แผ่นต่อนาที 1 เครื่อง").isSoftware).toBe(false);
    expect(line("(49) ค่าบริการอินเตอร์เน็ทความเร็วสูง").isSoftware).toBe(false);
    expect(line("ค่าใช้จ่ายโครงการพัฒนาระบบการเดินรถโดยสารด่วนพิเศษ (BRT)").isSoftware).toBe(false);
    expect(line("(4) ค่าใช้จ่ายในการอบรมเชิงปฏิบัติการเรื่อง ปัญญาประดิษฐ์กับแพทยศาสตรศึกษา").isSoftware).toBe(false);
  });

  test("a bracketed unit name is not what the line buys", () => {
    expect(lineText({ description: "(3) ค่าอาหารทำการนอกเวลา (สำนักงานพัฒนาระบบสาธารณสุข)", project: null })).toBe(
      "(3) ค่าอาหารทำการนอกเวลา",
    );
    expect(line("(3) ค่าอาหารทำการนอกเวลา (สำนักงานพัฒนาระบบสาธารณสุข)").isSoftware).toBe(false);
  });
});
