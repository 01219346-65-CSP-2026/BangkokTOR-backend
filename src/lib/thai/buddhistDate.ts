// Pure conversions for Thai source data. No I/O, no clock — fixture-testable.
// Every parser returns undefined rather than guessing: a wrong date is invisible,
// a missing one is not.

const BE_OFFSET = 543;

// Thai feeds carry both 2568 (BE) and 2025 (CE). Blind subtraction turns a CE
// year into 1482, so the year is sniffed. The ranges don't overlap this century.
const BE_THRESHOLD = 2200;

const THAI_ZERO = 0x0e50;

export function beToCe(year: number): number {
  if (!Number.isFinite(year)) return NaN;
  return year >= BE_THRESHOLD ? year - BE_OFFSET : year;
}

export function ceToBe(year: number): number {
  if (!Number.isFinite(year)) return NaN;
  return year < BE_THRESHOLD ? year + BE_OFFSET : year;
}

export function thaiDigitsToArabic(input: string): string {
  return input.replace(/[๐-๙]/g, (d) => String(d.charCodeAt(0) - THAI_ZERO));
}

// Handles 15/03/2568, 15-03-2568, 2568-03-15, and Thai numerals.
// UTC because these are calendar dates, not instants — local time shifts the day.
export function parseThaiDate(input: string): Date | undefined {
  if (!input) return undefined;

  const s = thaiDigitsToArabic(input).trim();

  let year: number, month: number, day: number;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const ymd = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3]);
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
