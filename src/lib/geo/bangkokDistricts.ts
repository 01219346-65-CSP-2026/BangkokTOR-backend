// Bangkok's 50 เขต (khet), keyed by the BMA's own two-digit district code —
// the last two digits of the MOI area code 10xx (01 พระนคร … 50 บางบอน).
//
// The code is the join key between the backend's `byDistrict` rollup and the
// frontend's boundary file (src/data/bangkokKhet.json there), so the map never
// matches districts by Thai spelling. `en` is the romanisation the boundary
// source (geoBoundaries THA ADM2) uses, which is why Watthana reads "Vadhana".

export type BangkokDistrict = { code: string; th: string; en: string };

export const BANGKOK_DISTRICTS: readonly BangkokDistrict[] = [
  { code: "01", th: "พระนคร", en: "Phra Nakhon" },
  { code: "02", th: "ดุสิต", en: "Dusit" },
  { code: "03", th: "หนองจอก", en: "Nong Chok" },
  { code: "04", th: "บางรัก", en: "Bang Rak" },
  { code: "05", th: "บางเขน", en: "Bang Khen" },
  { code: "06", th: "บางกะปิ", en: "Bang Kapi" },
  { code: "07", th: "ปทุมวัน", en: "Pathum Wan" },
  { code: "08", th: "ป้อมปราบศัตรูพ่าย", en: "Pom Prap Sattru Phai" },
  { code: "09", th: "พระโขนง", en: "Phra Khanong" },
  { code: "10", th: "มีนบุรี", en: "Min Buri" },
  { code: "11", th: "ลาดกระบัง", en: "Lat Krabang" },
  { code: "12", th: "ยานนาวา", en: "Yan Nawa" },
  { code: "13", th: "สัมพันธวงศ์", en: "Samphanthawong" },
  { code: "14", th: "พญาไท", en: "Phaya Thai" },
  { code: "15", th: "ธนบุรี", en: "Thon Buri" },
  { code: "16", th: "บางกอกใหญ่", en: "Bangkok Yai" },
  { code: "17", th: "ห้วยขวาง", en: "Huai Khwang" },
  { code: "18", th: "คลองสาน", en: "Khlong San" },
  { code: "19", th: "ตลิ่งชัน", en: "Taling Chan" },
  { code: "20", th: "บางกอกน้อย", en: "Bangkok Noi" },
  { code: "21", th: "บางขุนเทียน", en: "Bang Khun Thian" },
  { code: "22", th: "ภาษีเจริญ", en: "Phasi Charoen" },
  { code: "23", th: "หนองแขม", en: "Nong Khaem" },
  { code: "24", th: "ราษฎร์บูรณะ", en: "Rat Burana" },
  { code: "25", th: "บางพลัด", en: "Bang Phlat" },
  { code: "26", th: "ดินแดง", en: "Din Daeng" },
  { code: "27", th: "บึงกุ่ม", en: "Bueng Kum" },
  { code: "28", th: "สาทร", en: "Sathon" },
  { code: "29", th: "บางซื่อ", en: "Bang Sue" },
  { code: "30", th: "จตุจักร", en: "Chatuchak" },
  { code: "31", th: "บางคอแหลม", en: "Bang Kho Laem" },
  { code: "32", th: "ประเวศ", en: "Prawet" },
  { code: "33", th: "คลองเตย", en: "Khlong Toei" },
  { code: "34", th: "สวนหลวง", en: "Suan Luang" },
  { code: "35", th: "จอมทอง", en: "Chom Thong" },
  { code: "36", th: "ดอนเมือง", en: "Don Mueang" },
  { code: "37", th: "ราชเทวี", en: "Ratchathewi" },
  { code: "38", th: "ลาดพร้าว", en: "Lat Phrao" },
  { code: "39", th: "วัฒนา", en: "Vadhana" },
  { code: "40", th: "บางแค", en: "Bang Khae" },
  { code: "41", th: "หลักสี่", en: "Lak Si" },
  { code: "42", th: "สายไหม", en: "Sai Mai" },
  { code: "43", th: "คันนายาว", en: "Khan Na Yao" },
  { code: "44", th: "สะพานสูง", en: "Saphan Sung" },
  { code: "45", th: "วังทองหลาง", en: "Wang Thonglang" },
  { code: "46", th: "คลองสามวา", en: "Khlong Sam Wa" },
  { code: "47", th: "บางนา", en: "Bang Na" },
  { code: "48", th: "ทวีวัฒนา", en: "Thawi Watthana" },
  { code: "49", th: "ทุ่งครุ", en: "Thung Khru" },
  { code: "50", th: "บางบอน", en: "Bang Bon" },
];

/** Spellings the feeds use that aren't the canonical name, already squashed
 *  (see `squash`). ราษฎร์ is often typed with ฏ (ราษฏร์) — they look alike. */
const ALIASES: Record<string, string> = {
  ราษฏร์บูรณะ: "24",
  ราษฎร์บูรณ: "24",
  ป้อมปราบ: "08",
  watthana: "39",
  sathorn: "28",
  pathumwan: "07",
  khlongtoey: "33",
  thonburi: "15",
};

/** Lower-case, no spaces, no "เขต"/"khet"/"district" wrapper. */
function squash(raw: string): string {
  return raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^(เขต|khet)/, "")
    .replace(/district$/, "");
}

const BY_NAME = new Map<string, string>([
  ...BANGKOK_DISTRICTS.flatMap((d): [string, string][] => [
    [squash(d.th), d.code],
    [squash(d.en), d.code],
  ]),
  ...Object.entries(ALIASES),
]);

/**
 * A feed's free-text เขต → the BMA district code, or null when it isn't one of
 * Bangkok's 50 (an อำเภอ from another province mis-tagged as Bangkok, say).
 */
export function normalizeBangkokDistrict(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return BY_NAME.get(squash(raw)) ?? null;
}
