// What kind of software work is this? The website's หมวดหมู่ filter.
//
// Replaces the goods category for the software listing: the national e-GP
// data has no goods column at all (the field normalize reads as goodsCategory
// holds the procurement-method group), so every TOR fell through to "other" —
// and once everything listed is software, "IT" would be the only real answer
// anyway. The question a bidder actually asks is build vs maintain vs consult,
// and which technical area.
//
// Pure (§4.5): title in, tags out. Multi-label on purpose — "พัฒนาแพลตฟอร์ม
// AI" is both development and AI/data, and a single bucket would hide it from
// half the people looking for it. Measured on the first 60 FY2569 software
// TORs (2026-09-30): 57 tagged, 3 left as "other".

export const WORK_TYPES = [
  "development",
  "aiData",
  "cloudInfra",
  "maintenance",
  "consulting",
  "learning",
  "other",
] as const;
export type WorkTypeId = (typeof WORK_TYPES)[number];

export type WorkTypeSignal = { type: WorkTypeId; term: string };

type Rule = [term: string | RegExp, type: WorkTypeId];

// Latin acronyms need word boundaries: "ai" is inside "detail", "ma" inside
// "management".
const RULES: Rule[] = [
  // Building something new.
  ["พัฒนาระบบ", "development"],
  ["พัฒนาแพลตฟอร์ม", "development"],
  ["พัฒนาโปรแกรม", "development"],
  ["จัดทำระบบ", "development"],
  ["แอปพลิเคชัน", "development"],
  ["แอปพลิเคชั่น", "development"],
  [/\bapplication\b/i, "development"],
  ["เว็บไซต์", "development"],
  [/\bwebsite\b/i, "development"],
  ["โปรแกรมประยุกต์", "development"],
  [/\berp\b/i, "development"],

  ["ปัญญาประดิษฐ์", "aiData"],
  [/\bai\b/i, "aiData"],
  ["เรียนรู้ของเครื่อง", "aiData"],
  [/machine learning/i, "aiData"],
  [/big data/i, "aiData"],
  ["ข้อมูลขนาดใหญ่", "aiData"],
  ["ฐานข้อมูล", "aiData"],
  ["ข้อมูลกลาง", "aiData"],
  ["บูรณาการข้อมูล", "aiData"],
  ["วิเคราะห์ข้อมูล", "aiData"],
  ["ภูมิสารสนเทศ", "aiData"],
  ["สารสนเทศเชิงพื้นที่", "aiData"],
  ["สารสนเทศภูมิศาสตร์", "aiData"],
  [/\bgis\b/i, "aiData"],
  ["ดาวเทียม", "aiData"],
  ["สำรวจระยะไกล", "aiData"],

  [/cloud/i, "cloudInfra"],
  ["คลาวด์", "cloudInfra"],
  [/\bsaas\b/i, "cloudInfra"],
  ["เซิร์ฟเวอร์", "cloudInfra"],
  [/\bserver\b/i, "cloudInfra"],
  [/data center/i, "cloudInfra"],
  ["ศูนย์ข้อมูล", "cloudInfra"],
  ["เครือข่าย", "cloudInfra"],
  ["ความมั่นคงปลอดภัย", "cloudInfra"],
  ["ไซเบอร์", "cloudInfra"],
  [/cyber/i, "cloudInfra"],
  ["ศูนย์ปฏิบัติการเฝ้าระวัง", "cloudInfra"],

  ["บำรุงรักษา", "maintenance"],
  ["ซ่อมบำรุง", "maintenance"],
  ["ดูแลระบบ", "maintenance"],
  ["ต่ออายุ", "maintenance"],
  [/\bma\b/, "maintenance"],

  ["ที่ปรึกษา", "consulting"],

  ["ทักษะดิจิทัล", "learning"],
  ["ทักษะด้านดิจิทัล", "learning"],
  ["การเรียนรู้", "learning"],
  [/e-?learning/i, "learning"],
  ["ธนาคารหน่วยกิต", "learning"],
  [/credit bank/i, "learning"],
  ["ฝึกอบรม", "learning"],
];

// Generic system words. They mean "a build" only when nothing says this is
// upkeep or hosting — "บำรุงรักษาระบบสารสนเทศ" is an MA contract, not a build.
const GENERIC_DEVELOPMENT = ["ระบบสารสนเทศ", "แพลตฟอร์ม", /platform/i] as const;

// The portal's own consulting marker, in the field normalize files as goodsCategory.
const CONSULTING_MARKER = "งานจ้างที่ปรึกษา";

function matches(haystack: string, term: string | RegExp): boolean {
  return typeof term === "string" ? haystack.includes(term) : term.test(haystack);
}

export type WorkTypeVerdict = { workTypes: WorkTypeId[]; workTypeSignals: WorkTypeSignal[] };

export function classifyWorkTypes(input: { title: string; goodsCategory?: string | null }): WorkTypeVerdict {
  const title = input.title ?? "";
  const found = new Set<WorkTypeId>();
  const workTypeSignals: WorkTypeSignal[] = [];

  const hit = (type: WorkTypeId, term: string | RegExp) => {
    if (found.has(type)) return;
    found.add(type);
    workTypeSignals.push({ type, term: String(term) });
  };

  for (const [term, type] of RULES) if (matches(title, term)) hit(type, term);
  if (input.goodsCategory?.includes(CONSULTING_MARKER)) hit("consulting", CONSULTING_MARKER);

  if (!found.has("development") && !found.has("maintenance") && !found.has("cloudInfra")) {
    for (const term of GENERIC_DEVELOPMENT) {
      if (matches(title, term)) {
        hit("development", term);
        break;
      }
    }
  }

  // Stored as ["other"] rather than [] so the filter and its counts treat the
  // untagged like any other option.
  const workTypes = WORK_TYPES.filter((t) => found.has(t));
  return { workTypes: workTypes.length ? workTypes : ["other"], workTypeSignals };
}
