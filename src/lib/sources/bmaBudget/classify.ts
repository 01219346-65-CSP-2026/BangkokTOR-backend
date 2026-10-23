import { classifySoftware, classifyWorkTypes, type WorkTypeId } from "../../classify/index.ts";
import type { ParsedLine } from "./parse.ts";

// Which budget lines are software work — by the SAME rule the TOR pipeline
// uses (lib/classify/software.ts), so "software budget" and "software TORs"
// on the dashboard count the same thing and can be compared.
//
// Guards in front of it, each from reading the 2570 lines:
//  - Salaries and wages (expense codes 01xxx/02xxx, งบบุคลากร) are never a
//    TOR, whatever the line's wording.
//  - Office machines whose names carry "ระบบดิจิทัล" (photocopiers, cameras)
//    score just over the software threshold on that word alone; utility
//    bills (internet, phone, post) are not tendered work either.
//  - A unit name in brackets — "(สำนักงานพัฒนาระบบสาธารณสุข)" on a meals or
//    postage line — is who spends it, not what it buys, so it is not read.
//  - Budget lines are vaguer than TOR titles: "พัฒนาระบบการเดินรถโดยสารด่วน
//    พิเศษ (BRT)" is a ฿93M bus system, not software, yet "พัฒนาระบบ" alone
//    clears the threshold. So a line must also name something IT outright.

const EQUIPMENT =
  /เครื่องถ่ายเอกสาร|กล้องถ่ายภาพ|กล้องโทรทัศน์วงจรปิด|เครื่องพิมพ์|เครื่องปรับอากาศ|เครื่องสำรองไฟ|โทรทัศน์|เครื่องฉายภาพ|โทรศัพท์/;
const UTILITY = /ค่าบริการอินเ[ทต]อร์เน็[ตท]|ค่าโทรศัพท์|ค่าไฟฟ้า|ค่าน้ำประปา|ค่าไปรษณีย์/;
/** Courses and meetings about IT ("อบรม…ปัญญาประดิษฐ์", 2569) are events the
 *  agency runs, not software it buys. */
const EVENT = /อบรม|ประชุม|สัมมนา/;
const IT_TERM =
  /สารสนเทศ|ซอฟต์แวร์|โปรแกรม|แอปพลิเคชัน|แอพพลิเคชั่น|ฐานข้อมูล|เว็บ|ดิจิทัล|คอมพิวเตอร์|ออนไลน์|อิเล็กทรอนิกส์|e-Service|\bAI\b|ปัญญาประดิษฐ์|IP Address|DNS|คลาวด์|[Cc]loud|[Dd]ata|[Pp]latform|แพลตฟอร์ม|เครือข่าย|[Aa]pplication|[Mm]obile|iOS|Android/;

/** The line's own words, with bracketed unit names ("(สำนักงาน…)") removed. */
export function lineText(line: Pick<ParsedLine, "description" | "project">): string {
  return [line.project?.title, line.description]
    .filter(Boolean)
    .join(" ")
    .replace(/\((?:สำนักงาน|สำนัก|ฝ่าย|กอง|ศูนย์|กลุ่มงาน)[^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type LineClassification = {
  isSoftware: boolean;
  softwareScore: number;
  workTypes: WorkTypeId[];
};

export function classifyBudgetLine(line: Pick<ParsedLine, "expenseCode" | "budgetType" | "description" | "project">): LineClassification {
  const text = lineText(line);
  const notWork =
    line.budgetType === "personnel" ||
    /^0[12]/.test(line.expenseCode) ||
    EQUIPMENT.test(line.description) ||
    UTILITY.test(line.description) ||
    EVENT.test(line.description) ||
    !IT_TERM.test(`${text} ${line.project?.details ?? ""}`);
  const verdict = classifySoftware({ title: text, category: "it", contractType: null });
  const isSoftware = !notWork && verdict.isSoftware;
  return {
    isSoftware,
    softwareScore: verdict.score,
    workTypes: isSoftware ? classifyWorkTypes({ title: text }).workTypes : [],
  };
}
