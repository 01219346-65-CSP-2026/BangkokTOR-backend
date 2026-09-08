import { test, expect, describe } from "bun:test";
import {
  normalizeCkanRow,
  normalizeExtras,
  parsePoint,
  isUsableRow,
  alignRow,
  SOURCE_ID,
} from "./normalize.ts";
import type { CkanRow } from "./client.ts";
import type { RawProject } from "../types.ts";

// The declared header and row 0 of the live resource, verbatim (probed
// 2026-09-08). 32 declared columns, 29 values — the gateway's shift defect.
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

const RAW: RawProject = {
  projectId: "67039549408",
  fields: SHIFTED_ROW,
  header: FIELDS,
};

describe("normalizeCkanRow — the shifted live row, end to end", () => {
  const tor = normalizeCkanRow(RAW);

  test("identity and provenance", () => {
    expect(tor.sourceId).toBe(SOURCE_ID);
    expect(tor.projectId).toBe("67039549408");
    expect(tor.sourceUrl).toContain("proj_id=67039549408");
    expect(tor.fetchedAt).toBeInstanceOf(Date);
  });

  test("fields before the shift come through untouched", () => {
    expect(tor.projectName).toContain("รถไฟทางคู่");
    expect(tor.agency).toBe("การรถไฟแห่งประเทศไทย");
    expect(tor.department).toBe("ฝ่ายโครงการพิเศษและก่อสร้าง");
    expect(tor.province).toBe("กรุงเทพมหานคร");
  });

  test("money is THB integers", () => {
    expect(tor.budget).toBe(28759000000);
    // ราคากลาง (reference price), NOT the agreed price.
    expect(tor.averageBudget).toBe(28719940000);
  });

  test("procurementMethod is the GROUP, goodsCategory the method", () => {
    expect(tor.procurementMethod).toContain("e-bidding");
    expect(tor.goodsCategory).toContain("ประกาศเชิญชวนทั่วไป");
  });

  // The whole reason buddhistDate grew a Thai-month branch: "21 มิ.ย. 67"
  // is 2567 BE = 2024 CE. Without it every announcedAt would be null.
  test("the Thai-abbreviated BE date parses to a CE Date", () => {
    expect(tor.announcedAt).toBeInstanceOf(Date);
    expect(tor.announcedAt?.toISOString()).toBe("2024-06-21T00:00:00.000Z");
  });

  test("no deadline field is invented — FR-13 is still open", () => {
    expect(tor).not.toHaveProperty("closesAt");
    expect(tor).not.toHaveProperty("deadline");
  });
});

describe("normalizeExtras — the fields the shift corrupts", () => {
  const extras = normalizeExtras(RAW);

  // THE assertion. Unaligned, ละติจูดโครงการ holds a company name.
  test("a latitude is a number in Thailand, not a company name", () => {
    expect(extras.location).toBeDefined();
    const [lng, lat] = extras.location!.coordinates as [number, number];
    expect(lat).toBeCloseTo(16.4267, 3);
    expect(lng).toBeCloseTo(102.8257, 3);
    // GeoJSON is [lng, lat] — longitude first. Backwards puts this in the ocean.
    expect(lng).toBeGreaterThan(lat);
  });

  test("the company name lands in winnerName", () => {
    expect(extras.winnerName).toBe("กิจการร่วมค้า ช.ทวี - เอเอส ก่อสร้าง");
  });

  test("district and subdistrict shift back into place", () => {
    expect(extras.district).toBe("ปทุมวัน");
    expect(extras.subdistrict).toBe("รองเมือง");
  });

  test("projectStatus is a status, not a longitude", () => {
    expect(extras.projectStatus).toBe("ระหว่างดำเนินการ");
    expect(Number.isNaN(Number(extras.projectStatus))).toBe(true);
  });

  test("contract dates parse from the Thai abbreviated form", () => {
    expect(extras.contractSignedAt?.toISOString()).toBe("2024-12-12T00:00:00.000Z");
    // 71 BE -> 2028 CE, a future contract end.
    expect(extras.contractEndsAt?.toISOString()).toBe("2028-03-31T00:00:00.000Z");
  });

  test("winnerTaxId is the tax id", () => {
    expect(extras.winnerTaxId).toBe("0993000510631");
  });
});

describe("alignRow", () => {
  test("leaves an unshifted row untouched", () => {
    const clean: CkanRow = { "รหัสโครงการ": "1", "ชื่อโครงการ": "x", "จังหวัด": "y" };
    const fields = ["รหัสโครงการ", "ชื่อโครงการ", "จังหวัด"];
    expect(alignRow(clean, fields)).toBe(clean); // same object, not a copy
  });

  test("with no header, does nothing", () => {
    expect(alignRow(SHIFTED_ROW, [])).toBe(SHIFTED_ROW);
  });
});

describe("parsePoint", () => {
  test("rejects (0,0) — an unset field, not the Gulf of Guinea", () => {
    expect(parsePoint({ [("ละติจูดโครงการ")]: 0, [("ลองจิจูดโครงการ")]: 0 })).toBeUndefined();
  });

  test("rejects a coordinate outside Thailand", () => {
    expect(parsePoint({ "ละติจูดโครงการ": 51.5, "ลองจิจูดโครงการ": -0.12 })).toBeUndefined();
  });

  test("falls back to the numeric pair when there is no WKT", () => {
    const p = parsePoint({ "ละติจูดโครงการ": 13.75, "ลองจิจูดโครงการ": 100.5 });
    expect(p?.coordinates).toEqual([100.5, 13.75]);
  });
});

describe("isUsableRow", () => {
  test("accepts a row with an id and a title", () => {
    expect(isUsableRow(SHIFTED_ROW)).toBe(true);
  });

  test("rejects a row that cannot be joined to e-GP", () => {
    expect(isUsableRow({ "ชื่อโครงการ": "x" })).toBe(false);
    expect(isUsableRow({ "รหัสโครงการ": "1" })).toBe(false);
  });
});
