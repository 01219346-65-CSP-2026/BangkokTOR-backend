import { test, expect, describe } from "bun:test";
import { detectPhantomColumns, realignRow, type CkanRow } from "./client.ts";
import { COL } from "./columns.ts";

// The declared header, verbatim from the live gateway (resource
// e4eaa1b4-…-988ee25b898d, probed 2026-09-08). 32 columns; three of them are
// declared and never populated.
const FIELDS = [
  "_id", "ลำดับ", "รหัสโครงการ", "ชื่อโครงการ", "ชื่อประเภทโครงการ",
  "ชื่อหน่วยงาน", "ชื่อหน่วยงานย่อย", "วิธีจัดซื้อฯ", "กลุ่มวิธีจัดซื้อฯ",
  "วันที่ประกาศ", "งบประมาณ(บาท)", "ราคากลาง(บาท)", "ราคาตกลงซื้อ/จ้าง",
  "ปีงบประมาณ", "วันที่เกิดรายการ", "จังหวัด", "จังหวัด(Eng)", "เขต/อำเภอ",
  "เขต/อำเภอ(Eng)", "แขวง/ตำบล", "แขวง/ตำบล(Eng)", "สถานะโครงการ",
  "พิกัดของโครงการ", "ละติจูดโครงการ", "ลองจิจูดโครงการ", "เลขนิติบุคคล",
  "ชื่อผู้ชนะ", "เลขที่สัญญา", "วันที่ลงนามสัญญา", "วันที่สิ้นสุดสัญญา",
  "งบสัญญา(บาท)", "สถานะสัญญา",
];

// Row 0 of the resource, exactly as the gateway returned it — 29 values spread
// across 32 keys. Read at face value this says a construction consortium is a
// latitude.
const SHIFTED_ROW: CkanRow = {
  "_id": 1,
  "ลำดับ": 1,
  "รหัสโครงการ": 67039549408,
  "ชื่อโครงการ": "ประกวดราคาจ้างก่อสร้างงานจ้างก่อสร้างโครงการรถไฟทางคู่",
  "ชื่อประเภทโครงการ": "จ้างก่อสร้าง",
  "ชื่อหน่วยงาน": "การรถไฟแห่งประเทศไทย",
  "ชื่อหน่วยงานย่อย": "ฝ่ายโครงการพิเศษและก่อสร้าง",
  "วิธีจัดซื้อฯ": "วิธีการจัดหา ประกาศเชิญชวนทั่วไป คัดเลือก เฉพาะเจาะจง",
  "กลุ่มวิธีจัดซื้อฯ": "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "วันที่ประกาศ": "21 มิ.ย. 67",
  "งบประมาณ(บาท)": 28759000000,
  "ราคากลาง(บาท)": 28719940000,
  "ราคาตกลงซื้อ/จ้าง": 28679000000,
  "ปีงบประมาณ": 2568,
  "วันที่เกิดรายการ": "12 ธ.ค. 67",
  "จังหวัด": "กรุงเทพมหานคร",
  // ── everything from here is under the WRONG key ──
  "จังหวัด(Eng)": "ปทุมวัน",
  "เขต/อำเภอ": "รองเมือง",
  "เขต/อำเภอ(Eng)": "ระหว่างดำเนินการ",
  "แขวง/ตำบล": "POINT(102.82574415206909 16.426720674030822)",
  "แขวง/ตำบล(Eng)": 16.426720674031,
  "สถานะโครงการ": 102.82574415207,
  "พิกัดของโครงการ": "0993000510631",
  "ละติจูดโครงการ": "กิจการร่วมค้า ช.ทวี - เอเอส ก่อสร้าง",
  "ลองจิจูดโครงการ": "กส.14/ทค./2567",
  "เลขนิติบุคคล": "12 ธ.ค. 67",
  "ชื่อผู้ชนะ": "31 มี.ค. 71",
  "เลขที่สัญญา": 28679000000,
  "วันที่ลงนามสัญญา": "ระหว่างดำเนินการ",
  "วันที่สิ้นสุดสัญญา": null,
  "งบสัญญา(บาท)": null,
  "สถานะสัญญา": null,
};

describe("detectPhantomColumns", () => {
  test("catches the live shifted row — 29 values, 32 declared keys", () => {
    expect(detectPhantomColumns(FIELDS, SHIFTED_ROW)).toBe(true);
  });

  test("leaves a resource without phantom columns alone", () => {
    const clean = ["รหัสโครงการ", "ชื่อโครงการ", "จังหวัด"];
    expect(detectPhantomColumns(clean, { "รหัสโครงการ": "1", "ชื่อโครงการ": "x", "จังหวัด": "y" }))
      .toBe(false);
  });

  test("returns false with no sample or no header", () => {
    expect(detectPhantomColumns(FIELDS, undefined)).toBe(false);
    expect(detectPhantomColumns([], SHIFTED_ROW)).toBe(false);
  });
});

describe("realignRow", () => {
  const fixed = realignRow(SHIFTED_ROW, FIELDS);

  // THE test. Everything else in this file is scaffolding for this assertion:
  // before realignment ละติจูดโครงการ holds a company name.
  test("a latitude is a number, not a company name", () => {
    expect(typeof SHIFTED_ROW[COL.lat]).toBe("string"); // the defect, as shipped
    expect(typeof fixed[COL.lat]).toBe("number");
    expect(fixed[COL.lat]).toBeCloseTo(16.4267, 3);
  });

  test("the longitude lands under the longitude key", () => {
    expect(fixed[COL.lng]).toBeCloseTo(102.8257, 3);
  });

  test("the WKT point lands under the point key", () => {
    expect(fixed[COL.point]).toBe("POINT(102.82574415206909 16.426720674030822)");
  });

  test("the company name lands under ชื่อผู้ชนะ", () => {
    expect(fixed[COL.winnerName]).toBe("กิจการร่วมค้า ช.ทวี - เอเอส ก่อสร้าง");
  });

  test("the district and subdistrict shift back into place", () => {
    expect(fixed[COL.district]).toBe("ปทุมวัน");
    expect(fixed[COL.subdistrict]).toBe("รองเมือง");
  });

  test("the project status lands under สถานะโครงการ", () => {
    expect(fixed[COL.status]).toBe("ระหว่างดำเนินการ");
  });

  // Columns before the first phantom were never wrong and must not move.
  test("everything up to จังหวัด is untouched", () => {
    expect(fixed[COL.projectId]).toBe(67039549408);
    expect(fixed[COL.agency]).toBe("การรถไฟแห่งประเทศไทย");
    expect(fixed[COL.budget]).toBe(28759000000);
    expect(fixed[COL.province]).toBe("กรุงเทพมหานคร");
  });

  test("the phantom keys are gone from the output", () => {
    expect(Object.keys(fixed)).toHaveLength(29);
    expect(fixed).not.toHaveProperty("จังหวัด(Eng)");
  });
});
