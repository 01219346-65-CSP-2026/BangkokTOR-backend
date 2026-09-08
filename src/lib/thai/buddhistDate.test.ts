import { test, expect, describe } from "bun:test";
import {
  beToCe,
  ceToBe,
  thaiDigitsToArabic,
  parseThaiDate,
  parseThb,
} from "./buddhistDate.ts";

describe("beToCe", () => {
  test("converts a Buddhist-era year", () => {
    expect(beToCe(2568)).toBe(2025);
  });

  // The whole reason for the threshold: a CE year must pass through untouched,
  // or 2025 silently becomes 1482.
  test("leaves a CE year alone", () => {
    expect(beToCe(2025)).toBe(2025);
  });

  test("NaN in, NaN out", () => {
    expect(beToCe(NaN)).toBeNaN();
  });

  // CKAN drops the century: "67" is 2567 BE, not the year 67.
  test("expands a 2-digit BE year", () => {
    expect(beToCe(67)).toBe(2024);
    expect(beToCe(68)).toBe(2025);
  });
});

describe("ceToBe", () => {
  test("converts a CE year", () => {
    expect(ceToBe(2025)).toBe(2568);
  });

  test("leaves a BE year alone", () => {
    expect(ceToBe(2568)).toBe(2568);
  });
});

describe("thaiDigitsToArabic", () => {
  test("maps the full digit range", () => {
    expect(thaiDigitsToArabic("๐๑๒๓๔๕๖๗๘๙")).toBe("0123456789");
  });

  test("leaves other characters intact", () => {
    expect(thaiDigitsToArabic("๑๕/๐๓/๒๕๖๘")).toBe("15/03/2568");
  });
});

describe("parseThaiDate", () => {
  // Stored CE, always UTC — a local-time Date would shift the calendar day.
  test("parses dd/mm/BE", () => {
    expect(parseThaiDate("15/03/2568")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
  });

  test("parses dd-mm-BE", () => {
    expect(parseThaiDate("15-03-2568")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
  });

  test("parses BE-mm-dd", () => {
    expect(parseThaiDate("2568-03-15")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
  });

  test("parses Thai numerals", () => {
    expect(parseThaiDate("๑๕/๐๓/๒๕๖๘")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
  });

  test("accepts a CE year without shifting it", () => {
    expect(parseThaiDate("15/03/2025")?.toISOString()).toBe("2025-03-15T00:00:00.000Z");
  });

  // Date.UTC rolls 31 Feb forward to 3 March rather than failing. Silently
  // accepting that would file a date the source never published.
  test("rejects a date that does not exist", () => {
    expect(parseThaiDate("31/02/2568")).toBeUndefined();
  });

  test("rejects an out-of-range month", () => {
    expect(parseThaiDate("15/13/2568")).toBeUndefined();
  });

  test("rejects junk and empty input", () => {
    expect(parseThaiDate("not a date")).toBeUndefined();
    expect(parseThaiDate("")).toBeUndefined();
  });

  // The ONLY shape the CKAN gateway ships — verified over 300 live rows on
  // 2026-09-08: a Thai month abbreviation with a 2-digit BE year, never digits.
  describe("Thai month abbreviation + 2-digit BE year", () => {
    test("parses the live format", () => {
      // 67 -> 2567 BE -> 2024 CE
      expect(parseThaiDate("21 มิ.ย. 67")?.toISOString()).toBe("2024-06-21T00:00:00.000Z");
      expect(parseThaiDate("12 ธ.ค. 67")?.toISOString()).toBe("2024-12-12T00:00:00.000Z");
    });

    // All twelve appear in the resource; a missing one silently nulls a date.
    test("resolves every month token seen in the resource", () => {
      const expected: Array<[string, string]> = [
        ["1 ม.ค. 68", "2025-01-01"], ["1 ก.พ. 68", "2025-02-01"],
        ["1 มี.ค. 68", "2025-03-01"], ["1 เม.ย. 68", "2025-04-01"],
        ["1 พ.ค. 68", "2025-05-01"], ["1 มิ.ย. 68", "2025-06-01"],
        ["1 ก.ค. 68", "2025-07-01"], ["1 ส.ค. 68", "2025-08-01"],
        ["1 ก.ย. 68", "2025-09-01"], ["1 ต.ค. 68", "2025-10-01"],
        ["1 พ.ย. 68", "2025-11-01"], ["1 ธ.ค. 68", "2025-12-01"],
      ];
      for (const [input, iso] of expected) {
        expect(parseThaiDate(input)?.toISOString()).toBe(`${iso}T00:00:00.000Z`);
      }
    });

    test("accepts a spelled-out month", () => {
      expect(parseThaiDate("21 มิถุนายน 2567")?.toISOString()).toBe("2024-06-21T00:00:00.000Z");
    });

    test("covers the resource's full year span (64-68 BE)", () => {
      expect(parseThaiDate("1 ม.ค. 64")?.getUTCFullYear()).toBe(2021);
      expect(parseThaiDate("1 ม.ค. 68")?.getUTCFullYear()).toBe(2025);
    });

    test("rejects an unknown month token rather than guessing", () => {
      expect(parseThaiDate("21 xx 67")).toBeUndefined();
    });
  });
});

describe("parseThb", () => {
  test("strips separators and the baht symbol", () => {
    expect(parseThb("฿1,234,567")).toBe(1234567);
  });

  test("strips a trailing บาท", () => {
    expect(parseThb("1,000บาท")).toBe(1000);
  });

  test("rounds satang away — money is THB integers (§4.5)", () => {
    expect(parseThb("1234.56")).toBe(1235);
  });

  test("accepts a number directly", () => {
    expect(parseThb(1234.4)).toBe(1234);
  });

  test("parses Thai numerals", () => {
    expect(parseThb("๑๐๐")).toBe(100);
  });

  // undefined, never 0 — a zero would read as a real budget of nothing.
  test("returns undefined for missing or unparseable input", () => {
    expect(parseThb("")).toBeUndefined();
    expect(parseThb("-")).toBeUndefined();
    expect(parseThb("ไม่ระบุ")).toBeUndefined();
    expect(parseThb(NaN)).toBeUndefined();
  });

  test("rejects a negative budget", () => {
    expect(parseThb(-5)).toBeUndefined();
  });
});
