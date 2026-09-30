import { describe, expect, test } from "bun:test";
import { isVerbatim } from "../ai/types.ts";
import { SKILL_VOCABULARY } from "../../modules/techstack/techstack.vocabulary.ts";
import { SKILL_ALIASES, tagSkills, type SkillSource } from "./tagSkills.ts";

function slugs(text: string): string[] {
  return tagSkills([{ text, chunkIndex: 0 }]).map((t) => t.slug).sort();
}

describe("tagSkills", () => {
  test("every vocabulary skill can be detected", () => {
    // A slug with no aliases can never match, so a profile claiming it would
    // score zero everywhere without anyone noticing.
    for (const { slug } of SKILL_VOCABULARY) {
      expect(SKILL_ALIASES[slug]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("finds English names", () => {
    expect(slugs("พัฒนาด้วย React และ Node.js บนฐานข้อมูล PostgreSQL")).toEqual([
      "nodejs",
      "postgresql",
      "react",
    ]);
  });

  test("finds Thai names", () => {
    expect(slugs("จัดทำระบบสารสนเทศภูมิศาสตร์ ตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล")).toEqual([
      "gisQgis",
      "pdpa",
    ]);
  });

  test("an ASCII alias must be its own token", () => {
    expect(slugs("LOGISTICS management")).toEqual([]);
    expect(slugs("Reactor maintenance")).toEqual([]);
    expect(slugs("JavaScript only")).toEqual([]);
  });

  test("case-sensitive where the name is also an English word", () => {
    expect(slugs("staff must react quickly")).toEqual([]);
  });

  test("React Native is not also React", () => {
    expect(slugs("แอปพลิเคชันมือถือด้วย React Native")).toEqual(["reactNative"]);
  });

  // Regressions from the live corpus (2026-09-30).
  test("switchgear GIS is not mapping GIS", () => {
    expect(slugs("ประกวดราคาซื้อHV GIS, MV GIS, SA system")).toEqual([]);
    expect(slugs("ซื้อHV Containerized GIS และอุปกรณ์")).toEqual([]);
    expect(slugs("พัฒนาระบบ GIS แผนที่")).toEqual(["gisQgis"]);
  });

  test("bidding through e-GP is boilerplate, integrating with it is a skill", () => {
    expect(slugs("ยื่นเอกสารในระบบ e-GP ได้ ตั้งแต่วันที่ประกาศ")).toEqual([]);
    expect(slugs("(Electronic Government Procurement : e-GP) ของกรมบัญชีกลาง")).toEqual([]);
    expect(slugs("ระบบต้องเชื่อมต่อข้อมูลกับระบบ e-GP ของกรมบัญชีกลาง")).toEqual(["egpApi"]);
  });

  test("ASP.NET is .NET", () => {
    expect(slugs("ASP.NET Core")).toEqual(["dotnet"]);
  });

  test("evidence is a verbatim quote from the source it cites", () => {
    const sources: SkillSource[] = [
      { text: "จ้างพัฒนาระบบ", chunkIndex: null },
      { text: "ข้อ 4.2 ผู้รับจ้าง   ต้องใช้ Docker ในการติดตั้ง", chunkIndex: 3 },
    ];
    const [tag] = tagSkills(sources);
    expect(tag?.slug).toBe("docker");
    expect(tag?.chunkIndex).toBe(3);
    expect(isVerbatim(tag!.evidence, sources[1]!.text)).toBe(true);
  });

  test("one tag per skill, from the first source that mentions it", () => {
    const tags = tagSkills([
      { text: "ระบบ GIS", chunkIndex: null },
      { text: "QGIS อีกครั้ง", chunkIndex: 1 },
    ]);
    expect(tags).toHaveLength(1);
    expect(tags[0]?.chunkIndex).toBeNull();
  });
});
