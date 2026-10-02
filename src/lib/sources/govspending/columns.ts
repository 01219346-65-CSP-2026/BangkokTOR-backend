import { COL } from "../ckan/columns.ts";

// govspending's bulk CSV header → the CKAN column names normalize.ts already
// reads. Translating at the edge means one normalizer, one classifier, one
// test suite for both feeds; the rest of the pipeline never learns which feed a
// row came from.
//
// Verified against 2569-egp-contract-1.csv (2026-09-30): 28 columns, every row
// 28 values — none of CKAN's phantom-column shift.
//
// Two names cross over, deliberately. CKAN files the e-bidding/specific
// method under กลุ่มวิธีจัดซื้อฯ and the "วิธีการจัดหา ประกาศเชิญชวนทั่วไป…"
// grouping under วิธีจัดซื้อฯ — backwards — and normalizeCkanRow reads them
// that way round. govspending labels them correctly, so they are swapped here
// to land the same VALUES under the same keys.
export const HEADER_ALIASES: Record<string, string> = {
  "ชื่อโครงการจัดซื้อจัดจ้าง": COL.title,
  "ชื่อวิธีการจัดซื้อจัดจ้าง": COL.methodGroup,
  "ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง": COL.method,
  "วันที่ประกาศจัดซื้อจัดจ้าง": COL.announcedAt,
  "วงเงินงบประมาณ (บาท)": COL.budget,
  "ราคากลาง (บาท)": COL.referencePrice,
  "ราคาที่ตกลงซื้อ / จ้าง ซึ่งรวมทุกสัญญาในโครงการ (บาท)": COL.agreedPrice,
  "ละติจูดของโครงการ": COL.lat,
  "ลองจิจูดของโครงการ": COL.lng,
  "เลขประจำตัวนิติบุคคล 13 หลัก": COL.winnerTaxId,
  "ชื่อผู้ชนะการเสนอราคา": COL.winnerName,
  "วันที่ลงนามในสัญญา": COL.contractSignedAt,
  "วงเงินงบประมาณในสัญญา (บาท)": COL.contractBudget,
  // Identical in both feeds, listed so the mapping is complete and checkable:
  // ลำดับ, รหัสโครงการ, ชื่อประเภทโครงการ, ชื่อหน่วยงาน, ชื่อหน่วยงานย่อย,
  // ปีงบประมาณ, วันที่เกิดรายการ, จังหวัด, เขต/อำเภอ, แขวง/ตำบล, สถานะโครงการ,
  // พิกัดของโครงการ, เลขที่สัญญา, วันที่สิ้นสุดสัญญา, สถานะสัญญา.
};

// Header spacing is not something to trust across exports ("(บาท)" vs " (บาท)").
const key = (name: string) => name.replace(/\s+/g, "");
const ALIASES_BY_KEY = new Map(Object.entries(HEADER_ALIASES).map(([from, to]) => [key(from), to]));

/** One CSV record, re-keyed to CKAN names. Unknown columns pass through as-is. */
export function toCkanFields(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(record)) {
    out[ALIASES_BY_KEY.get(key(name)) ?? name.trim()] = value;
  }
  return out;
}
