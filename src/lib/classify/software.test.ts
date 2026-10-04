import { test, expect, describe } from "bun:test";
import { CLASSIFIER_VERSION, classifyTor, toMethodId } from "./index.ts";

// Every title below is verbatim from the live CKAN resource (600 rows sampled
// 2026-09-08). 17 matched a naive software keyword scan; only 3 were genuine
// development work. That ratio is the whole point of this classifier, and these
// tests are what keep it honest.

const classify = (
  projectName: string,
  procurementType: string,
  goodsCategory = "จ้างเหมาอื่นๆ",
) => classifyTor({ projectName, procurementType, goodsCategory });

describe("genuine software development — should classify TRUE", () => {
  test("system development, hired as a service", () => {
    const r = classify(
      "ประกวดราคาจ้างโครงการพัฒนาระบบแจ้งเตือนภัยผ่านสัญญาณโทรศัพท์เคลื่อนที่ ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์",
      "จ้างทำของ/จ้างเหมาบริการ",
    );
    expect(r.isSoftware).toBe(true);
  });

  test("information-system development for fleet management", () => {
    const r = classify(
      "ประกวดราคาจ้างโครงการอื่นๆ โครงการจ้างพัฒนาระบบสารสนเทศบริหารเครื่องจักรกล และบัญชีเงินทุนหมุนเวียน",
      "จ้างทำของ/จ้างเหมาบริการ",
    );
    expect(r.isSoftware).toBe(true);
  });

  test("an explicit ซอฟต์แวร์ development hire", () => {
    const r = classify("จ้างพัฒนาซอฟต์แวร์ระบบบริหารจัดการเอกสารภายใน", "จ้างทำของ/จ้างเหมาบริการ");
    expect(r.isSoftware).toBe(true);
    expect(r.softwareConfidence).toBeGreaterThan(0.6);
  });
});

describe("keyword hits that are NOT software — should classify FALSE", () => {
  // These are the false positives §3 warned about, all real.

  test("integrated digital radio equipment — a lease, not development", () => {
    const r = classify(
      "ประกวดราคาเช่างานเช่าซื้อพร้อมบริการวิทยุสื่อสารระบบดิจิทัลแบบบูรณาการ ในพื้นที่ภาคเหนือ",
      "เช่า",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("a digital technology CENTRE — construction", () => {
    const r = classify(
      "ประกวดราคาจ้างก่อสร้างศูนย์รวมเทคโนโลยีดิจิทัลอัจฉริยะเพื่อสร้างเศรษฐกิจ การเรียนรู้ นวัตกรรม",
      "จ้างก่อสร้าง",
      "ที่ดินและสิ่งก่อสร้าง",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("computer equipment purchase, however information-flavoured", () => {
    const r = classify(
      "ประกวดราคาซื้อครุภัณฑ์คอมพิวเตอร์ รายการปรับปรุงระบบบูรณาการสารสนเทศด้านอุตุนิยมวิทยา",
      "ซื้อ",
      "วัสดุครุภัณฑ์คอมพิวเตอร์",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("17.8 million Smart Cards is a goods purchase", () => {
    const r = classify(
      "ซื้อบัตรประจำตัวประชาชนที่ออกด้วยระบบคอมพิวเตอร์แบบอเนกประสงค์ (Smart Card) จำนวน 17,867,902 บัตร",
      "ซื้อ",
      "วัสดุครุภัณฑ์คอมพิวเตอร์",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("buying Microsoft licences is not commissioning development", () => {
    const r = classify(
      "ซื้อสิทธิการใช้ Online Service และ Software Assurance สำหรับโปรแกรมคอมพิวเตอร์ยี่ห้อ Microsoft",
      "ซื้อ",
      "วัสดุครุภัณฑ์คอมพิวเตอร์",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("a building to house computers is construction", () => {
    const r = classify(
      "ประกวดราคาจ้างก่อสร้างศูนย์ควบคุมระบบคอมพิวเตอร์กลาง สำนักบริหารการทะเบียน",
      "จ้างก่อสร้าง",
      "ที่ดินและสิ่งก่อสร้าง",
    );
    expect(r.isSoftware).toBe(false);
  });

  test("ICT equipment lease for community centres", () => {
    const r = classify(
      "ประกวดราคาเช่าโครงการยกระดับศูนย์การเรียนรู้ ICT ชุมชนสู่ศูนย์ดิจิทัลชุมชน กิจกรรม การเช่าอุปกรณ์",
      "เช่า",
      "เช่าอื่นๆ",
    );
    expect(r.isSoftware).toBe(false);
  });

  // The miscategorisation trap: a hospital lab filed under "data entry".
  test("a clinical lab is not software, whatever the portal filed it under", () => {
    const r = classify(
      "จ้างเหมาบริการตรวจวิเคราะห์ทางห้องปฏิบัติการสำหรับผู้ป่วยนอก",
      "จ้างทำของ/จ้างเหมาบริการ",
      "จ้างเหมางานบันทึกข้อมูล",
    );
    expect(r.isSoftware).toBe(false);
  });
});

describe("the verdict reports its own uncertainty", () => {
  test("confidence stays in [0.5, 1]", () => {
    const r = classify("จ้างพัฒนาระบบ", "จ้างทำของ/จ้างเหมาบริการ");
    expect(r.softwareConfidence).toBeGreaterThanOrEqual(0.5);
    expect(r.softwareConfidence).toBeLessThanOrEqual(1);
  });

  test("signals record which rules fired, so a verdict can be audited", () => {
    const r = classify("จ้างพัฒนาซอฟต์แวร์", "จ้างทำของ/จ้างเหมาบริการ");
    expect(r.softwareSignals.length).toBeGreaterThan(0);
    expect(r.softwareSignals.some((s) => s.rule.includes("ซอฟต์แวร์"))).toBe(true);
  });

  test("vocabulary mapping runs alongside the verdict", () => {
    const r = classifyTor({
      projectName: "จ้างพัฒนาระบบสารสนเทศ",
      goodsCategory: "วัสดุครุภัณฑ์คอมพิวเตอร์",
      procurementType: "จ้างทำของ/จ้างเหมาบริการ",
      procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
      projectStatus: "ระหว่างดำเนินการ",
    });
    expect(r.category).toBe("it");
    expect(r.contractType).toBe("hire");
    expect(r.methodId).toBe("eBidding");
    expect(r.statusId).toBe("inProgress");
    expect(r.workTypes).toEqual(["development"]);
    expect(r.classifierVersion).toBe(CLASSIFIER_VERSION);
  });
});

describe("procurement method vocabulary", () => {
  // e-GP reports methodId 16 (e-bidding) for BMA projects labelled plain
  // "ประกวดราคา"; it is not the invite-only selection method.
  test("bare ประกวดราคา is e-bidding; คัดเลือก is selection", () => {
    expect(toMethodId("ประกวดราคา")).toBe("eBidding");
    expect(toMethodId("ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)")).toBe("eBidding");
    expect(toMethodId("คัดเลือก")).toBe("competitive");
    expect(toMethodId("เฉพาะเจาะจง")).toBe("specific");
  });
});

describe("terms added from real misses", () => {
  // 69099310567 scored 38 before โปรแกรมประยุกต์ / คลังข้อมูล were terms.
  test("a network-and-application maintenance tender is software", () => {
    const r = classifyTor({
      projectName:
        "ประกวดราคาจ้างบำรุงรักษาระบบเครือข่ายและโปรแกรมประยุกต์ ตามโครงการคลังข้อมูลกลางกรุงเทพมหานคร (BMA Data Warehouse) ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
      procurementType: "จ้างทำของ/จ้างเหมาบริการ",
      procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
    });
    expect(r.isSoftware).toBe(true);
  });

  test("a cybersecurity maintenance tender is software", () => {
    const r = classifyTor({
      projectName:
        "ประกวดราคาจ้างจัดจ้างบำรุงรักษาระบบป้องกันภัยคุมคามทางไซเบอร์ของระบบเครือข่ายและคอมพิวเตอร์ จำนวน 1 งาน ด้วยวิธีประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
      procurementType: "จ้างทำของ/จ้างเหมาบริการ",
    });
    expect(r.isSoftware).toBe(true);
  });
});
