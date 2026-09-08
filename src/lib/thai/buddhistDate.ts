// Pure conversions for Thai source data. No I/O, no clock — fixture-testable.
// Every parser returns undefined rather than guessing: a wrong date is invisible,
// a missing one is not.

const BE_OFFSET = 543;

// Thai feeds carry both 2568 (BE) and 2025 (CE). Blind subtraction turns a CE
// year into 1482, so the year is sniffed. The ranges don't overlap this century.
const BE_THRESHOLD = 2200;

const THAI_ZERO = 0x0e50;

// Thai month abbreviations. The CKAN gateway ships every date in this form —
// "21 มิ.ย. 67" — never as digits (verified over 300 live rows, 2026-09-08).
// Keyed without the trailing dot so "มิ.ย." and "มิ.ย" both resolve.
const THAI_MONTHS: Record<string, number> = {
  "ม.ค": 1, "ก.พ": 2, "มี.ค": 3, "เม.ย": 4, "พ.ค": 5, "มิ.ย": 6,
  "ก.ค": 7, "ส.ค": 8, "ก.ย": 9, "ต.ค": 10, "พ.ย": 11, "ธ.ค": 12,
  // Full names, in case a source spells them out.
  "มกราคม": 1, "กุมภาพันธ์": 2, "มีนาคม": 3, "เมษายน": 4,
  "พฤษภาคม": 5, "มิถุนายน": 6, "กรกฎาคม": 7, "สิงหาคม": 8,
  "กันยายน": 9, "ตุลาคม": 10, "พฤศจิกายน": 11, "ธันวาคม": 12,
};

// A 2-digit Thai year is BE with the century dropped: 67 -> 2567 -> 2024 CE.
// Anything below 100 is expanded; the ranges don't collide this century.
const BE_CENTURY = 2500;

export function beToCe(year: number): number {
  if (!Number.isFinite(year)) return NaN;
  // "67" is a BE year with the century dropped, not the year 67.
  const full = year > 0 && year < 100 ? year + BE_CENTURY : year;
  return full >= BE_THRESHOLD ? full - BE_OFFSET : full;
}

export function ceToBe(year: number): number {
  if (!Number.isFinite(year)) return NaN;
  return year < BE_THRESHOLD ? year + BE_OFFSET : year;
}

export function thaiDigitsToArabic(input: string): string {
  return input.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - THAI_ZERO));
}

// Resolves "มิ.ย." / "มิ.ย" / "มิถุนายน" to 1-12, or undefined.
function thaiMonthToNumber(token: string): number | undefined {
  return THAI_MONTHS[token.replace(/\.$/, "")];
}

// Handles "21 มิ.ย. 67" (the only shape CKAN ships), 15/03/2568, 15-03-2568,
// 2568-03-15, and Thai numerals. Years may be 2- or 4-digit BE, or CE.
// UTC because these are calendar dates, not instants — local time shifts the day.
export function parseThaiDate(input: string): Date | undefined {
  if (!input) return undefined;

  const s = thaiDigitsToArabic(input).trim();

  let year: number, month: number, day: number;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  // "21 มิ.ย. 67" — day, Thai month token, 2- or 4-digit year.
  const named = s.match(/^(\d{1,2})\s+([^\s\d]+)\s+(\d{2,4})$/);

  if (named) {
    const m = thaiMonthToNumber(named[2]!);
    if (m === undefined) return undefined;
    day = Number(named[1]);
    month = m;
    year = Number(named[3]);
  } else if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    return undefined;
  }

  year = beToCe(year);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  const date = new Date(Date.UTC(year, month - 1, day));

  // Date rolls 31/02 forward to March 3rd, so a changed day means the input
  // named a date that doesn't exist.
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) {
    return undefined;
  }

  return date;
}

// THB integers (§4.5). Satang rounded away; a float budget invites comparison bugs.
// undefined rather than 0, which would read as a real budget of nothing.
export function parseThb(input: string | number): number | undefined {
  if (typeof input === "number") {
    return Number.isFinite(input) && input >= 0 ? Math.round(input) : undefined;
  }
  if (!input) return undefined;

  const cleaned = thaiDigitsToArabic(input)
    .replace(/[฿,\s]/g, "")
    .replace(/บาท$/, "");

  if (!/^\d+(\.\d+)?$/.test(cleaned)) return undefined;

  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}
