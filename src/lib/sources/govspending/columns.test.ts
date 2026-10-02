import { describe, expect, test } from "bun:test";
import { normalizeCkanRow, normalizeExtras } from "../ckan/normalize.ts";
import { classifyRaw, scopeOf } from "../../../modules/ingest/scope.ts";
import { HEADER_ALIASES, toCkanFields } from "./columns.ts";

// Rows 1 and a software row of 2569-egp-contract-1.csv, verbatim (govspending bulk
// export, fetched 2026-09-30). Header names exactly as the file ships them.
const BUS_LEASE = {
  "ลำดับ": "1",
  "รหัสโครงการ": "68099218030",
  "ชื่อโครงการจัดซื้อจัดจ้าง": "ประกวดราคาเช่ารถโดยสารประจำทางปรับอากาศพลังงานสะอาด (EV) ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "ชื่อประเภทโครงการ": "เช่า",
  "ชื่อหน่วยงาน": "องค์การขนส่งมวลชนกรุงเทพ",
  "ชื่อหน่วยงานย่อย": "องค์การขนส่งมวลชนกรุงเทพ (ขสมก.) กรุงเทพฯ",
  "ชื่อวิธีการจัดซื้อจัดจ้าง": "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง": "วิธีการจัดหา ประกาศเชิญชวนทั่วไป คัดเลือก เฉพาะเจาะจง",
  "วันที่ประกาศจัดซื้อจัดจ้าง": "18 พ.ย. 68",
  "วงเงินงบประมาณ (บาท)": "15355600000",
  "ราคากลาง (บาท)": "15326737242",
  "ราคาที่ตกลงซื้อ / จ้าง ซึ่งรวมทุกสัญญาในโครงการ (บาท)": "14905000000",
  "ปีงบประมาณ": "2569",
  "วันที่เกิดรายการ": "29 ม.ค. 69",
  "จังหวัด": "กรุงเทพมหานคร",
  "เขต/อำเภอ": "พระนคร",
  "แขวง/ตำบล": "พระบรมมหาราชวัง",
  "สถานะโครงการ": "ระหว่างดำเนินการ",
  "พิกัดของโครงการ": "",
  "ละติจูดของโครงการ": "",
  "ลองจิจูดของโครงการ": "",
  "เลขประจำตัวนิติบุคคล 13 หลัก": "0365529000042",
  "ชื่อผู้ชนะการเสนอราคา": "บริษัท นครชัยแอร์ จำกัด",
  "เลขที่สัญญา": "ช.16/2569",
  "วันที่ลงนามในสัญญา": "29 ม.ค. 69",
  "วันที่สิ้นสุดสัญญา": "29 ม.ค. 76",
  "วงเงินงบประมาณในสัญญา (บาท)": "14905000000",
  "สถานะสัญญา": "ระหว่างดำเนินการ",
};

const SOFTWARE = {
  "ลำดับ": "306",
  "รหัสโครงการ": "69019031771",
  "ชื่อโครงการจัดซื้อจัดจ้าง": "ประกวดราคาจ้างโครงการพัฒนาระบบเทคโนโลยีเพื่อการบริการจัดการทรัพยากรทางทะเลและชายฝั่งเพื่อลดผลกระทบจากการบริหารจัดการน้ำ แขวงทุ่งสองห้อง เขตหลักสี่ กรุงเทพมหานคร 1 ระบบ ประจำปีงบประมาณ พ.ศ. 2569 ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "ชื่อประเภทโครงการ": "จ้างทำของ/จ้างเหมาบริการ",
  "ชื่อหน่วยงาน": "กรมทรัพยากรทางทะเลและชายฝั่ง",
  "ชื่อหน่วยงานย่อย": "กรมทรัพยากรทางทะเลและชายฝั่ง",
  "ชื่อวิธีการจัดซื้อจัดจ้าง": "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "ชื่อกลุ่มวิธีการจัดซื้อจัดจ้าง": "วิธีการจัดหา ประกาศเชิญชวนทั่วไป คัดเลือก เฉพาะเจาะจง",
  "วันที่ประกาศจัดซื้อจัดจ้าง": "19 ม.ค. 69",
  "วงเงินงบประมาณ (บาท)": "318678000",
  "ราคากลาง (บาท)": "318678000",
  "ราคาที่ตกลงซื้อ / จ้าง ซึ่งรวมทุกสัญญาในโครงการ (บาท)": "318450000",
  "ปีงบประมาณ": "2569",
  "วันที่เกิดรายการ": "31 ก.ค. 69",
  "จังหวัด": "กรุงเทพมหานคร",
  "เขต/อำเภอ": "หลักสี่",
  "แขวง/ตำบล": "ทุ่งสองห้อง",
  "สถานะโครงการ": "ระหว่างดำเนินการ",
  "พิกัดของโครงการ": "",
  "ละติจูดของโครงการ": "",
  "ลองจิจูดของโครงการ": "",
  "เลขประจำตัวนิติบุคคล 13 หลัก": "D888869001507",
  "ชื่อผู้ชนะการเสนอราคา": "กิจการค้าร่วม ทีเอ็นอาร์ที",
  "เลขที่สัญญา": "สลก.22/2569",
  "วันที่ลงนามในสัญญา": "31 ก.ค. 69",
  "วันที่สิ้นสุดสัญญา": "20 ก.ค. 71",
  "วงเงินงบประมาณในสัญญา (บาท)": "318450000",
  "สถานะสัญญา": "ระหว่างดำเนินการ",
};

const raw = (record: Record<string, string>) => ({
  projectId: record["รหัสโครงการ"]!,
  fields: toCkanFields(record),
  header: [],
});

describe("govspending → CKAN column mapping", () => {
  const canonical = normalizeCkanRow(raw(BUS_LEASE));
  const extras = normalizeExtras(raw(BUS_LEASE));

  test("every header in the real file maps to a column normalize.ts reads", () => {
    const mapped = Object.keys(toCkanFields(BUS_LEASE));
    expect(mapped).toContain("ชื่อโครงการ");
    expect(mapped).toContain("ละติจูดโครงการ");
    expect(mapped).toContain("เลขนิติบุคคล");
    expect(mapped.length).toBe(Object.keys(BUS_LEASE).length);
  });

  test("identity, money and dates", () => {
    expect(canonical.projectId).toBe("68099218030");
    expect(canonical.agency).toBe("องค์การขนส่งมวลชนกรุงเทพ");
    expect(canonical.budget).toBe(15_355_600_000);
    expect(canonical.averageBudget).toBe(15_326_737_242);
    expect(canonical.announcedAt?.toISOString().slice(0, 10)).toBe("2025-11-18");
  });

  test("the method pair lands the way CKAN rows have it", () => {
    expect(canonical.procurementMethod).toBe("ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)");
    expect(canonical.goodsCategory).toBe("วิธีการจัดหา ประกาศเชิญชวนทั่วไป คัดเลือก เฉพาะเจาะจง");
  });

  test("location, status and contract — no realignment needed", () => {
    expect(extras.fiscalYear).toBe(2569);
    expect(extras.district).toBe("พระนคร");
    expect(extras.subdistrict).toBe("พระบรมมหาราชวัง");
    expect(extras.projectStatus).toBe("ระหว่างดำเนินการ");
    expect(extras.winnerName).toBe("บริษัท นครชัยแอร์ จำกัด");
    expect(extras.winnerTaxId).toBe("0365529000042");
    expect(extras.contractNumber).toBe("ช.16/2569");
    expect(extras.location).toBeUndefined();
  });

  test("a bus lease is not software", () => {
    expect(scopeOf(classifyRaw(raw(BUS_LEASE)), 2569)).toBe("not-software");
  });

  test("a software-development row from the same file is kept", () => {
    expect(scopeOf(classifyRaw(raw(SOFTWARE)), 2569)).toBe("in-scope");
  });

  test("header spacing differences still map", () => {
    expect(toCkanFields({ "วงเงินงบประมาณ(บาท)": "1" })["งบประมาณ(บาท)"]).toBe("1");
    expect(Object.keys(HEADER_ALIASES).length).toBe(13);
  });
});
