import { beToCe, thaiDigitsToArabic } from "./buddhistDate.ts";

// The bid deadline, read out of a ประกาศเชิญชวน (invitation to bid).
//
// No feed publishes a closing date as data. The invitation states it in one
// fixed sentence, verified on real e-GP and BMA documents (2026-10-02):
//
//   ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์
//   ในวันที่ ๒๐ ตุลาคม ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น.
//
// The DRAFT invitation (annoudoc_* in the e-GP "Temp" bundle) has the same
// sentence with the date left blank, "ในวันที่ ระหว่างเวลา น. ถึง น.", which
// must come back as undefined, never as a guess.
//
// Pure: text in, deadline out. No clock, no I/O.

export type BidDeadline = {
  /** Start of the submission window, as an instant (Bangkok, UTC+7). */
  opensAt: Date;
  /** End of the submission window: the deadline. */
  closesAt: Date;
  /** The sentence it was read from, for a reader to check against the PDF. */
  quote: string;
};

/**
 * Thai above/below-line marks (ั ิ ี ึ ื ุ ู ฺ and ็ ่ ้ ๊ ๋ ์ ํ ๎). PDF text
 * extraction drops them unpredictably: one real BMA invitation comes out as
 * "ผูยื่นขอเสนอตองเสนอราคา". Matching on the base consonants alone is what
 * makes one pattern hold for both renderings.
 */
const COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g;

/**
 * Older Thai fonts (and Word's PDF export with them) draw shifted vowel and
 * tone marks from a private-use block, U+F700–U+F71A, instead of the real
 * characters. A real BMA invitation spells ระหว่าง with U+F70A for ่. Mapped
 * back to Unicode Thai so both matching and the displayed quote are correct.
 */
const PUA: Record<number, string> = {
  0xf700: "ฐ",
  0xf70f: "ญ",
  0xf701: "\u0E34",
  0xf702: "\u0E35",
  0xf703: "\u0E36",
  0xf704: "\u0E37",
  0xf705: "\u0E48",
  0xf706: "\u0E49",
  0xf707: "\u0E4A",
  0xf708: "\u0E4B",
  0xf709: "\u0E4C",
  0xf70a: "\u0E48",
  0xf70b: "\u0E49",
  0xf70c: "\u0E4A",
  0xf70d: "\u0E4B",
  0xf70e: "\u0E4C",
  0xf710: "\u0E31",
  0xf711: "\u0E4D",
  0xf712: "\u0E47",
  0xf713: "\u0E48",
  0xf714: "\u0E49",
  0xf715: "\u0E4A",
  0xf716: "\u0E4B",
  0xf717: "\u0E4C",
  0xf718: "\u0E38",
  0xf719: "\u0E39",
  0xf71a: "\u0E3A",
};

export function normalizeThaiPua(text: string): string {
  return text.replace(/[\uF700-\uF71A]/g, (c) => PUA[c.charCodeAt(0)] ?? "");
}

export function stripThaiMarks(text: string): string {
  return text.replace(COMBINING, "");
}

const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  // Abbreviated forms, in case an agency's template uses them.
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];
// Stripped name (and stripped name without dots) → month 1–12.
const MONTH_BY_NAME = new Map<string, number>();
MONTHS.forEach((name, i) => {
  const key = stripThaiMarks(name);
  MONTH_BY_NAME.set(key, (i % 12) + 1);
  MONTH_BY_NAME.set(key.replace(/\./g, ""), (i % 12) + 1);
});

// After stripThaiMarks + thaiDigitsToArabic:
//   "ในวันท 20 ตลาคม 2569 ระหวางเวลา 09.00 น. ถง 12.00 น."
// ("ที่" → "ท", "ถึง" → "ถง"). Whitespace is optional everywhere because the
// extractor splits and joins lines at random.
const SENTENCE =
  /ในวนท\s*(\d{1,2})\s*([^\s\d]+?)\s*(?:พ\s*\.?\s*ศ\s*\.?\s*)?(\d{4})\s*ระหวางเวลา\s*(\d{1,2})\s*[.:]\s*(\d{2})\s*น\s*\.?\s*ถ\s*ง\s*(\d{1,2})\s*[.:]\s*(\d{2})\s*น/;

// Narrows the search to the bid sentence. Other "ในวันที่" dates in the
// document (the announcement date, the document number's date) come with no
// time window, so the window itself is the real anchor — this only stops a
// match starting before the bid clause.
const ANCHOR = /เสนอราคา|ยนขอเสนอ/;

const BANGKOK_OFFSET_MS = 7 * 3_600_000;

function bangkokInstant(year: number, month: number, day: number, hour: number, minute: number): Date | undefined {
  if (hour > 23 || minute > 59) return undefined;
  const utc = Date.UTC(year, month - 1, day, hour, minute) - BANGKOK_OFFSET_MS;
  const check = new Date(Date.UTC(year, month - 1, day));
  // 31 กุมภาพันธ์ rolls into March in Date; a rolled date was never real.
  if (check.getUTCDate() !== day || check.getUTCMonth() !== month - 1) return undefined;
  return new Date(utc);
}

export function parseBidDeadline(input: string): BidDeadline | undefined {
  if (!input) return undefined;
  const text = normalizeThaiPua(input);

  const normalized = thaiDigitsToArabic(stripThaiMarks(text)).replace(/\s+/g, " ");
  const anchor = normalized.search(ANCHOR);
  const haystack = anchor >= 0 ? normalized.slice(anchor) : normalized;

  const m = haystack.match(SENTENCE);
  if (!m) return undefined;

  const [, d, monthName, y, oh, om, ch, cm] = m;
  const month = MONTH_BY_NAME.get(monthName!.replace(/\.$/, "")) ?? MONTH_BY_NAME.get(monthName!);
  if (month === undefined) return undefined;

  const year = beToCe(Number(y));
  const day = Number(d);
  const opensAt = bangkokInstant(year, month, day, Number(oh), Number(om));
  const closesAt = bangkokInstant(year, month, day, Number(ch), Number(cm));
  if (!opensAt || !closesAt || closesAt < opensAt) return undefined;

  return { opensAt, closesAt, quote: quoteFrom(text) };
}

/**
 * The original sentence, tone marks intact, for display: from the clause's
 * "ผู้ยื่นข้อเสนอ…" to the closing "น.". Located as the first dated "ในวันที่"
 * followed by a time window — the same thing the parser matched — so an
 * earlier clause that merely mentions วันยื่นข้อเสนอ is not quoted instead.
 */
function quoteFrom(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  const dated = /ในวันท\S*\s*[๐-๙\d]{1,2}\s/g;
  let at = -1;
  for (let m = dated.exec(flat); m; m = dated.exec(flat)) {
    if (/เวลา/.test(flat.slice(m.index, m.index + 80))) {
      at = m.index;
      break;
    }
  }
  if (at < 0) return "";
  const clause = flat.lastIndexOf("ผู", at);
  const from = clause >= 0 && at - clause < 160 ? clause : at;
  const until = flat.indexOf("ถึง", at);
  const end = until >= 0 ? flat.indexOf("น.", until) : -1;
  return flat.slice(from, end >= 0 ? end + 2 : at + 120).trim();
}
