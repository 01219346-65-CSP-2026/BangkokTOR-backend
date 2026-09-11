import type { TorCategoryId, TorContractId } from "./vocabulary.ts";

// Is this software development work?
//
// Pure (§4.5): fields in, verdict out, no I/O. The false-positive problem is
// invisible except in a test over real titles, which is only possible because
// this function never touches a database.
//
// Measured on 600 live CKAN rows (2026-09-08): a naive keyword scan
// (ซอฟต์แวร์/สารสนเทศ/คอมพิวเตอร์/ดิจิทัล/…) matches 2.8%, and inspection shows
// most of those are NOT development work — integrated radio equipment leases, a
// data-centre building, 17.8M Smart Cards, Microsoft licence renewals. Three of
// seventeen were genuine. So the negative rules below are not a refinement —
// they are most of the work.

export type SoftwareSignal = {
  rule: string;
  weight: number;
};

export type SoftwareVerdict = {
  isSoftware: boolean;
  score: number;
  confidence: number;
  signals: SoftwareSignal[];
};

export type SoftwareInput = {
  title: string;
  goodsCategory?: string | null;
  procurementType?: string | null;
  category: TorCategoryId;
  contractType: TorContractId | null;
};

export const SOFTWARE_THRESHOLD = 40;

// Terms that name software work itself.
const STRONG_POSITIVE: Array<[string, number]> = [
  ["ซอฟต์แวร์", 45],
  ["แอปพลิเคชัน", 45],
  ["แอปพลิเคชั่น", 45],
  ["พัฒนาระบบ", 45],
  ["พัฒนาโปรแกรม", 45],
  ["เว็บไซต์", 40],
  ["เว็บแอ", 40],
  ["ระบบสารสนเทศ", 40],
  ["ฐานข้อมูล", 35],
  ["โปรแกรมคอมพิวเตอร์", 40],
  ["ระบบบริหารจัดการ", 30],
  ["แพลตฟอร์ม", 35],
  ["คลาวด์", 25],
  ["ปัญญาประดิษฐ์", 35],
];

const WEAK_POSITIVE: Array<[string, number]> = [
  ["ดิจิทัล", 15],
  ["ออนไลน์", 15],
  ["เทคโนโลยีสารสนเทศ", 20],
  ["ระบบ", 8],
  ["ข้อมูล", 5],
];

// The half that does the real work. These are what make the keyword matches
// mostly wrong: a purchase of physical goods that happen to be computers, or a
// service contract for something that is not software at all.
const NEGATIVE: Array<[string, number]> = [
  ["ครุภัณฑ์", -35],
  ["เครื่องคอมพิวเตอร์", -30],
  ["เครื่องพิมพ์", -35],
  ["เครื่องสำรองไฟ", -35],
  ["จอภาพ", -30],
  ["อุปกรณ์", -20],
  ["วัสดุ", -25],
  ["เครื่องมือแพทย์", -40],
  ["เอกซเรย์", -40],
  ["อัลตราซาวด์", -40],
  // Lab and clinical services. These reach a "data" keyword through the source's
  // own miscategorisation (a hospital lab filed under จ้างเหมางานบันทึกข้อมูล),
  // so the title has to override the category.
  ["ห้องปฏิบัติการ", -45],
  ["ตรวจวิเคราะห์", -40],
  ["ตรวจวินิจฉัย", -40],
  ["ผู้ป่วย", -35],
  ["โรงพยาบาล", -25],
  ["ประกอบอาหาร", -40],
  ["ยานพาหนะ", -40],
  ["ก่อสร้าง", -40],
  ["ปรับปรุงอาคาร", -40],
  ["ซ่อมแซม", -30],
  ["ทำความสะอาด", -40],
  ["รักษาความปลอดภัย", -35],
  ["เช่าเครื่อง", -30],
  // Observed live: telecom/radio hardware leases score high on ดิจิทัล/ระบบ
  // while being pure equipment procurement.
  ["วิทยุสื่อสาร", -40],
  ["โทรคมนาคม", -30],
  ["สายสัญญาณ", -30],
  // Buying a licence for finished software is not commissioning development.
  ["สิทธิการใช้", -35],
  ["ลิขสิทธิ์", -30],
  ["บัตรประจำตัว", -35],
];

export function classifySoftware(input: SoftwareInput): SoftwareVerdict {
  const haystack = `${input.title} ${input.goodsCategory ?? ""}`.toLowerCase();
  const signals: SoftwareSignal[] = [];
  let score = 0;

  const add = (rule: string, weight: number) => {
    score += weight;
    signals.push({ rule, weight });
  };

  for (const [term, weight] of STRONG_POSITIVE) {
    if (haystack.includes(term.toLowerCase())) add(`term:${term}`, weight);
  }
  for (const [term, weight] of WEAK_POSITIVE) {
    if (haystack.includes(term.toLowerCase())) add(`term:${term}`, weight);
  }
  for (const [term, weight] of NEGATIVE) {
    if (haystack.includes(term.toLowerCase())) add(`neg:${term}`, weight);
  }

  // A service contract is how software gets bought; a purchase is how hardware
  // does. This is the single most discriminating non-keyword signal.
  if (input.contractType === "hire") add("contract:hire", 25);
  if (input.contractType === "purchase") add("contract:purchase", -30);
  if (input.contractType === "construction") add("contract:construction", -45);
  if (input.contractType === "lease") add("contract:lease", -20);

  // The IT category is necessary but nowhere near sufficient — §3 notes it is
  // mostly hardware. It earns a nudge, not a verdict.
  if (input.category === "it") add("category:it", 20);
  if (input.category === "dataEntry") add("category:dataEntry", 15);
  if (input.category === "medical") add("category:medical", -35);
  if (input.category === "construction") add("category:construction", -45);
  if (input.category === "agriculture") add("category:agriculture", -30);

  const isSoftware = score >= SOFTWARE_THRESHOLD;

  // Distance past the threshold, saturating at 60 points either side. A verdict
  // that squeaks over the line reports low confidence rather than claiming
  // certainty it does not have.
  const distance = Math.min(Math.abs(score - SOFTWARE_THRESHOLD), 60);
  const confidence = Math.round((0.5 + (distance / 60) * 0.5) * 100) / 100;

  return { isSoftware, score, confidence, signals };
}
