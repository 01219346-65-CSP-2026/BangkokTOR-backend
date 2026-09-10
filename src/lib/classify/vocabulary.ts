// Portal Thai free text -> the controlled vocabulary the frontend already
// commits to (../BangkokTOR-frontend/src/types/tor.ts). This is a contract to
// satisfy, not a vocabulary to invent.
//
// Thai keys are isolated here for the same reason as ckan/columns.ts: a Thai
// literal inside a mapping expression cannot be checked by eye.

export type TorCategoryId =
  | "medical" | "it" | "office" | "agriculture" | "electrical" | "education"
  | "equipment" | "construction" | "dataEntry" | "inspection" | "services"
  | "lease" | "other";

export type TorContractId = "purchase" | "hire" | "construction" | "lease";

export type TorMethodId = "eBidding" | "specific" | "competitive";

export type TorStatusId =
  | "inProgress" | "contracted" | "deliveredOnTime" | "deliveredComplete";

export const CATEGORY_BY_GOODS: Record<string, TorCategoryId> = {
  "วัสดุครุภัณฑ์คอมพิวเตอร์": "it",
  "วัสดุครุภัณฑ์วิทยาศาสตร์และการแพทย์": "medical",
  "วัสดุครุภัณฑ์สำนักงาน": "office",
  "วัสดุครุภัณฑ์การเกษตร": "agriculture",
  "วัสดุครุภัณฑ์ไฟฟ้าและวิทยุ": "electrical",
  "วัสดุครุภัณฑ์การศึกษา": "education",
  "วัสดุครุภัณฑ์อื่นๆ": "equipment",
  "ที่ดินและสิ่งก่อสร้าง": "construction",
  "จ้างก่อสร้างชลประทาน": "construction",
  "จ้างปรับปรุง ซ่อมแซมอาคาร": "construction",
  "จ้างเหมางานบันทึกข้อมูล": "dataEntry",
  "จ้างเหมางานตรวจสอบและรับรองมาตรฐาน": "inspection",
  "จ้างเหมาอื่นๆ": "services",
  "เช่าอื่นๆ": "lease",
};

// Substring fallbacks for category strings not seen in the sample. The portal
// ships free text, so an unrecognised value must degrade to a sensible guess
// and finally to "other" — never throw and break ingestion.
const CATEGORY_CONTAINS: Array<[string, TorCategoryId]> = [
  ["คอมพิวเตอร์", "it"],
  ["สารสนเทศ", "it"],
  ["วิทยาศาสตร์", "medical"],
  ["การแพทย์", "medical"],
  ["สำนักงาน", "office"],
  ["การเกษตร", "agriculture"],
  ["ไฟฟ้า", "electrical"],
  ["การศึกษา", "education"],
  ["ก่อสร้าง", "construction"],
  ["สิ่งก่อสร้าง", "construction"],
  ["ซ่อมแซม", "construction"],
  ["บันทึกข้อมูล", "dataEntry"],
  ["ตรวจสอบ", "inspection"],
  ["เช่า", "lease"],
  ["จ้างเหมา", "services"],
  ["ครุภัณฑ์", "equipment"],
];

export const CONTRACT_BY_TYPE: Record<string, TorContractId> = {
  "ซื้อ": "purchase",
  "จ้างทำของ/จ้างเหมาบริการ": "hire",
  "จ้างก่อสร้าง": "construction",
  "เช่า": "lease",
};

const CONTRACT_CONTAINS: Array<[string, TorContractId]> = [
  ["ก่อสร้าง", "construction"],
  ["เช่า", "lease"],
  ["จ้าง", "hire"],
  ["ซื้อ", "purchase"],
];

// Order matters: the e-bidding variant must be tested before bare ประกวดราคา,
// which is the non-electronic competitive method.
const METHOD_CONTAINS: Array<[string, TorMethodId]> = [
  ["e-bidding", "eBidding"],
  ["ประกวดราคาอิเล็กทรอนิกส์", "eBidding"],
  ["เฉพาะเจาะจง", "specific"],
  ["คัดเลือก", "competitive"],
  ["ประกวดราคา", "competitive"],
];

const STATUS_CONTAINS: Array<[string, TorStatusId]> = [
  ["ระหว่างดำเนินการ", "inProgress"],
  ["ส่งงานตามกำหนด", "deliveredOnTime"],
  ["ส่งงานตรงตามกำหนด", "deliveredOnTime"],
  ["ส่งงานครบถ้วน", "deliveredComplete"],
  ["สัญญา", "contracted"],
];

function lookup<T>(
  value: string | null | undefined,
  exact: Record<string, T>,
  contains: Array<[string, T]>,
  fallback: T,
): T {
  if (!value) return fallback;
  const key = value.trim();
  if (exact[key]) return exact[key];

  const haystack = key.toLowerCase();
  for (const [needle, id] of contains) {
    if (haystack.includes(needle.toLowerCase())) return id;
  }
  return fallback;
}

export function toCategoryId(goodsCategory: string | null | undefined): TorCategoryId {
  return lookup(goodsCategory, CATEGORY_BY_GOODS, CATEGORY_CONTAINS, "other");
}

export function toContractId(procurementType: string | null | undefined): TorContractId | null {
  return lookup<TorContractId | null>(procurementType, CONTRACT_BY_TYPE, CONTRACT_CONTAINS, null);
}

export function toMethodId(method: string | null | undefined): TorMethodId | null {
  return lookup<TorMethodId | null>(method, {}, METHOD_CONTAINS, null);
}

export function toStatusId(status: string | null | undefined): TorStatusId | null {
  return lookup<TorStatusId | null>(status, {}, STATUS_CONTAINS, null);
}
