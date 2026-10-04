import { describe, expect, test } from "bun:test";
import { parseBidDeadline } from "./bidDeadline.ts";

// Real extracted text (opendataloader output, whitespace as it came), captured
// 2026-10-02.

// 69069425602 — e-GP published bundle, annoudoc_* "(สำเนา)".
const EGP_SIGNED =
  "ตามเอกสารประกวดราคาอิเล็กทรอนิกส์กำหนด ๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๒ กรกฎาคม ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ ประกาศจนถึงวันเสนอราคา ๓. ผู้สนใจสามารถดูรายละเอียด";

// 69099316505 — BMA portal ประกาศเชิญชวน.
const BMA =
  "ิเล็กทรอนิกส์กำหนด ๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๒๐ ตุลาคม ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ ประกาศจนถึงวันเสนอราคา ๓. ผู้สนใจสามารถดูรายละเอียดและดาวน์โหลดเอกสารประกวดราคาอิเล็กทรอนิกส์เลขที่ ๘/๒๕๗๐ ลงวันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙";

// 69099318020 — BMA, extracted with the tone marks dropped.
const BMA_NO_MARKS =
  "เล็กทรอนิกสกําหนด ๒. ผูยื่นขอเสนอตองเสนอราคาทางระบบจัดซื้อจัดจางภาครัฐดวยอิเล็กทรอนิกสในวันที่ ๑ ตุลาคม ๒๕๖๙ ระหวางเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถจัดเตรียมเอกสารขอเสนอไดตั้งแตวันที่ประกาศจนถึงวัน เสนอราคา ๓. ผูสนใจสามารถดู";

// 68069115139 — the DRAFT from the e-GP Temp bundle: the date is blank.
const DRAFT =
  "้เป็นไปตามเอกสารประกวดราคาอิเล็กทรอนิกส์กำหนด ๒. ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ระหว่างเวลา น. ถึง น. ซึ่งสามารถจัดเตรียมเอกสารข้อเสนอได้ตั้งแต่วันที่ประกาศ จนถึงวันเสนอราคา ๓. ผู้สนใจสามารถด";

describe("parseBidDeadline", () => {
  test("reads the e-GP signed invitation", () => {
    const d = parseBidDeadline(EGP_SIGNED);
    expect(d?.opensAt.toISOString()).toBe("2026-07-22T02:00:00.000Z");
    expect(d?.closesAt.toISOString()).toBe("2026-07-22T05:00:00.000Z");
  });

  test("reads a BMA invitation", () => {
    expect(parseBidDeadline(BMA)?.closesAt.toISOString()).toBe("2026-10-20T05:00:00.000Z");
  });

  test("survives text extracted without tone marks", () => {
    expect(parseBidDeadline(BMA_NO_MARKS)?.closesAt.toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });

  // The whole point of not inventing a date.
  test("returns undefined for the draft with a blank date", () => {
    expect(parseBidDeadline(DRAFT)).toBeUndefined();
  });

  test("returns undefined for empty or unrelated text", () => {
    expect(parseBidDeadline("")).toBeUndefined();
    expect(parseBidDeadline("ประกาศ ณ วันที่ ๑ ตุลาคม พ.ศ. ๒๕๖๙")).toBeUndefined();
  });

  test("quotes the original sentence with its marks", () => {
    const quote = parseBidDeadline(BMA)!.quote;
    expect(quote).toContain("ผู้ยื่นข้อเสนอ");
    expect(quote).toContain("๒๐ ตุลาคม ๒๕๖๙");
    expect(quote.endsWith("๑๒.๐๐ น.")).toBe(true);
  });

  // 69099318020's newest invitation: the tone mark in ระหว่าง is drawn from
  // the Thai private-use block (U+F70A), and an earlier clause says
  // "วันยื่น ข้อเสนอ" with no date.
  test("reads private-use Thai glyphs, and quotes the bid clause", () => {
    const text =
      "ผูยื่นขอเสนอตองยื่นขอเสนอโดยแสดงหลักฐานถึงขีดความสามารถและความพรอมที่มีอยูในวันยื่น\nขอเสนอ โดยมีรายละเอียดดังนี้ ๑. ผูยื่นขอเสนอจะตองมีคุณสมบัติ ๒. ผูยื่นขอเสนอตองเสนอราคาทางระบบจัดซื้อจัดจางภาครัฐดวยอิเล็กทรอนิกสในวันที่ ๑ ตุลาคม\n๒๕๖๙ ระหว\uF70Aางเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น. ซึ่งสามารถ";
    const d = parseBidDeadline(text);
    expect(d?.closesAt.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(d?.quote.startsWith("ผูยื่นขอเสนอตองเสนอราคา")).toBe(true);
    expect(d?.quote).toContain("ระหว\u0E48าง");
  });

  test("rejects a date that does not exist", () => {
    const bad = BMA.replace("๒๐ ตุลาคม", "๓๑ กันยายน");
    expect(parseBidDeadline(bad)).toBeUndefined();
  });
});
