import { describe, expect, test } from "bun:test";
import { classifyWorkTypes } from "./workType.ts";

// Real FY2569 titles (govspending bulk export, 2026-09-30).
const types = (title: string, goodsCategory?: string) => classifyWorkTypes({ title, goodsCategory }).workTypes;

describe("classifyWorkTypes", () => {
  test("a system build", () => {
    expect(types("ประกวดราคาจ้างพัฒนาระบบการรังวัดด้วยระบบอิเล็กทรอนิกส์ (DOL Smart Survey)")).toEqual(["development"]);
  });

  test("an AI platform is both development and AI/data", () => {
    expect(types("ประกวดราคาจ้างโครงการพัฒนาแพลตฟอร์ม AI เพื่อสนับสนุนข้อมูลกลางของการนิคมอุตสาหกรรม")).toEqual([
      "development",
      "aiData",
    ]);
  });

  test("cloud hosting is infrastructure, not a build", () => {
    expect(types("ประกวดราคาจ้างโครงการเช่าใช้บริการระบบ Cloud Server สำหรับระบบฐานข้อมูลบริการสุขภาพดิจิทัล")).toEqual([
      "aiData",
      "cloudInfra",
    ]);
  });

  test("maintaining an information system is MA, not development", () => {
    expect(types("ประกวดราคาจ้างดูแลและบำรุงรักษาระบบสารสนเทศ เพื่อสนับสนุนการปฏิบัติการท่าอากาศยาน")).toEqual(["maintenance"]);
  });

  test("a generic information-system purchase with nothing else is a build", () => {
    expect(types("ประกวดราคาจ้างเหมาจัดหาระบบสารสนเทศ เพื่อปรับปรุงและทดแทนระบบสารสนเทศศูนย์บริการสาธารณสุข (HCIS)")).toEqual([
      "development",
    ]);
  });

  test("consulting, from the title or the portal's marker", () => {
    expect(types("จ้างที่ปรึกษาจัดทำระบบสารสนเทศการรายงานข้อมูลการปล่อยก๊าซเรือนกระจก")).toEqual(["development", "consulting"]);
    expect(types("โครงการศึกษาแนวทางระบบฐานข้อมูล", "งานจ้างที่ปรึกษา")).toContain("consulting");
  });

  test("digital-skills training", () => {
    expect(types("ประกวดราคาจ้างดำเนินโครงการยกระดับทักษะด้านดิจิทัลและปัญญาประดิษฐ์เพื่อคนไทย (TH-AI Passport)")).toEqual([
      "aiData",
      "learning",
    ]);
  });

  test("a SOC is security infrastructure", () => {
    expect(types("ประกวดราคาจ้างศูนย์ปฏิบัติการเฝ้าระวังความมั่นคงปลอดภัยระบบเทคโนโลยีสารสนเทศ ระยะที่ 2")).toEqual(["cloudInfra"]);
  });

  test("nothing recognisable is 'other', never empty", () => {
    expect(types("ประกวดราคาจ้างเหมาบริการผู้ให้บริการพร้อมสนับสนุนศูนย์ช่วยเหลือและจัดการปัญหาออนไลน์ (1212 ETDA)")).toEqual(["other"]);
  });

  test("Latin acronyms need word boundaries", () => {
    expect(types("detail management maintenance plan")).toEqual(["other"]);
  });

  test("each tag records the term that fired it", () => {
    const v = classifyWorkTypes({ title: "จ้างพัฒนาระบบ ERP" });
    expect(v.workTypeSignals).toEqual([{ type: "development", term: "พัฒนาระบบ" }]);
  });
});
