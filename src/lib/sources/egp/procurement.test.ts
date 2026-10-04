import { describe, expect, test } from "bun:test";
import { classifyRaw } from "../../../modules/ingest/scope.ts";
import { COL } from "../ckan/columns.ts";
import { toCaptureFields, type ProcurementDetail, type ProjectDetail } from "./procurement.ts";

// Recorded from e-GP getProcurementDetail / getProjectDetail, 69069425602, 2026-10-02.
const DETAIL: ProcurementDetail = {
  announceDate: "2026-08-09T17:00:00.000Z",
  deptSubName: "กรมเชื้อเพลิงธรรมชาติ กรุงเทพฯ",
  methodId: "16",
  priceBuild: 1442716.67,
  projectMoney: 1391000,
  projectName:
    "ประกวดราคาจ้างปรับปรุงข้อมูลปิโตรเลียมรูปแบบกระดาษสู่รูปแบบดิจิทัลเพื่อจำหน่ายและสนับสนุนการสำรวจและผลิตปิโตรเลียม ประจำปีงบประมาณ พ.ศ. 2569 ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  typeId: "03",
};
const PROJECT: ProjectDetail = { budgetYear: "2569", deptName: "กรมเชื้อเพลิงธรรมชาติ" };

describe("toCaptureFields", () => {
  test("maps an e-GP record onto the CKAN columns", () => {
    const { fields, unknownMethod } = toCaptureFields("69069425602", DETAIL, PROJECT, { province: "กรุงเทพมหานคร" });
    expect(unknownMethod).toBeNull();
    expect(fields[COL.agency]).toBe("กรมเชื้อเพลิงธรรมชาติ");
    expect(fields[COL.department]).toBe("กรมเชื้อเพลิงธรรมชาติ กรุงเทพฯ");
    expect(fields[COL.announcedAt]).toBe("2026-08-10");
    expect(fields[COL.province]).toBe("กรุงเทพมหานคร");
  });

  test("normalizes and classifies like any other feed row", () => {
    const c = classifyRaw({ projectId: "69069425602", fields: toCaptureFields("69069425602", DETAIL, PROJECT).fields });
    expect(c.canonical.budget).toBe(1391000);
    expect(c.canonical.averageBudget).toBe(1442717);
    expect(c.classification.methodId).toBe("eBidding");
    expect(c.classification.contractType).toBe("hire");
    expect(c.extras.fiscalYear).toBe(2569);
  });

  test("an unmapped method code is reported, not guessed", () => {
    const { fields, unknownMethod } = toCaptureFields("69069425602", { ...DETAIL, methodId: "17" }, PROJECT);
    expect(unknownMethod).toBe("17");
    expect(fields[COL.methodGroup]).toBeUndefined();
  });

  test("direct award code 19", () => {
    const c = classifyRaw({ projectId: "x", fields: toCaptureFields("69099371861", { ...DETAIL, methodId: "19" }, PROJECT).fields });
    expect(c.classification.methodId).toBe("specific");
  });
});

import { provinceFromMoiId } from "./procurement.ts";

describe("provinceFromMoiId", () => {
  // From e-GP rdbsysm011/listProvince (77 rows), 2026-10-03.
  const provinces = new Map([
    ["100000", "กรุงเทพมหานคร"],
    ["300000", "นครราชสีมา"],
    ["130000", "ปทุมธานี"],
  ]);

  test("a district-level code resolves to its province", () => {
    // มหาวิทยาลัยเทคโนโลยีสุรนารี's deptSubMoiId.
    expect(provinceFromMoiId("300101", provinces)).toBe("นครราชสีมา");
    expect(provinceFromMoiId("3000      ", provinces)).toBe("นครราชสีมา");
    expect(provinceFromMoiId("100000", provinces)).toBe("กรุงเทพมหานคร");
  });

  test("empty or unknown codes give undefined, not a guess", () => {
    expect(provinceFromMoiId(null, provinces)).toBeUndefined();
    expect(provinceFromMoiId("   ", provinces)).toBeUndefined();
    expect(provinceFromMoiId("990101", provinces)).toBeUndefined();
  });
});
