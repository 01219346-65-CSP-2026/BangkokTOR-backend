import { describe, expect, test } from "bun:test";
import { isDescriptive, sanitizeBullets } from "./summaryGuard.ts";
import { MAX_BULLET_CHARS, MAX_BULLETS, type SummaryBullet } from "./types.ts";

// FR-19: a point may state what the document says; it may never judge the
// agency that wrote it. These tests are the floor under that — the real check
// is reading generated output, because a marker list cannot catch a judgement
// phrased around it.

const bullet = (text: string, chunkIndex = 0): SummaryBullet => ({ text, chunkIndex });

describe("isDescriptive", () => {
  test("accepts a point that states a requirement", () => {
    expect(
      isDescriptive("ผู้ยื่นข้อเสนอต้องมีผลงานการดำเนินโครงการไม่น้อยกว่า 5 ปี"),
    ).toBe(true);
  });

  test("accepts concrete figures and deadlines", () => {
    expect(isDescriptive("กำหนดยื่นข้อเสนอภายในวันที่ 11 มกราคม 2568")).toBe(true);
    expect(isDescriptive("วางหลักประกันซองร้อยละ 5 ของวงเงินงบประมาณ")).toBe(true);
  });

  test("rejects a Thai fairness verdict", () => {
    expect(isDescriptive("เงื่อนไขนี้ไม่เป็นธรรมต่อผู้รับจ้าง")).toBe(false);
    expect(isDescriptive("ข้อกำหนดนี้กีดกันผู้ประกอบการรายย่อย")).toBe(false);
    expect(isDescriptive("ดูเหมือนจะเอื้อประโยชน์ให้ผู้ยื่นรายเดิม")).toBe(false);
  });

  test("rejects a Thai accusation of wrongdoing", () => {
    expect(isDescriptive("มีลักษณะน่าสงสัยว่าจะมีการฮั้วประมูล")).toBe(false);
    expect(isDescriptive("อาจเข้าข่ายทุจริต")).toBe(false);
    expect(isDescriptive("เป็นการล็อกสเปกให้ผู้ผลิตรายเดียว")).toBe(false);
  });

  test("rejects an English verdict, since the model does not always answer in Thai", () => {
    expect(isDescriptive("This condition is unfair to smaller contractors.")).toBe(false);
    expect(isDescriptive("The spec restricts competition.")).toBe(false);
    expect(isDescriptive("Evidence of collusion between bidders.")).toBe(false);
  });

  test("rejects the competition verdicts qwen2.5:7b actually produced", () => {
    // Measured: asked to judge a qualification clause with no constraint
    // prompt, the model returned these. The first two passed an earlier version
    // of the marker list, which is why ข้อจำกัด / จำกัดโอกาส / รายย่อย are on it.
    for (const verdict of [
      "เงื่อนไขมีข้อจำกัดสูงสำหรับผู้ประกอบการรายย่อยเนื่องจากต้องมีผลงานในวงเงินสูง",
      "จำกัดโอกาสให้ผู้ประกอบการรายย่อยเข้าร่วมประมูลและอาจทำให้ตลาดแคบลง",
      "อาจไม่เป็นธรรมกับผู้ประกอบการที่ไม่มีศักยภาพ",
    ]) {
      expect(isDescriptive(verdict)).toBe(false);
    }
  });

  test("still accepts the descriptive points the same model produced", () => {
    // The other half of the trade: widening the list must not start eating
    // ordinary requirements. These are real generations from a real TOR.
    for (const point of [
      "ผู้ยื่นข้อเสนอจะต้องลงนามในข้อตกลงคุณธรรม",
      "ผู้ยื่นข้อเสนอต้องมีผลการดำเนินงานไม่น้อยกว่า 5 ปี",
      "ต้องวางหลักประกันการเสนอราคาเป็นร้อยละ 5 ของวงเงินงบประมาณ",
      "ระยะเวลาส่งมอบงานภายใน 180 วัน นับจากวันลงนามในสัญญา",
      "ต้องยื่นข้อเสนอทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ วันที่ 11 มกราคม 2568",
    ]) {
      expect(isDescriptive(point)).toBe(true);
    }
  });

  test("rejects advice to the reader", () => {
    expect(isDescriptive("Bidders should be aware of the short deadline.")).toBe(false);
    expect(isDescriptive("ข้อควรระวังคือระยะเวลาที่สั้นมาก")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(isDescriptive("UNFAIR to the contractor")).toBe(false);
    expect(isDescriptive("Suspicious timing")).toBe(false);
  });

  test("matches English stems, so inflections do not slip through", () => {
    for (const text of [
      "restrict", "restricts", "restrictive",
      "favour", "favours", "favoritism",
      "monopoly", "monopolistic",
    ]) {
      expect(isDescriptive(text)).toBe(false);
    }
  });
});

describe("sanitizeBullets", () => {
  test("collapses whitespace so a length check measures what a reader sees", () => {
    const [only] = sanitizeBullets([bullet("  กำหนด   ยื่นข้อเสนอ\n ภายใน 11 ม.ค.  ")]);
    expect(only?.text).toBe("กำหนด ยื่นข้อเสนอ ภายใน 11 ม.ค.");
  });

  test("drops empty and whitespace-only points", () => {
    expect(sanitizeBullets([bullet(""), bullet("   "), bullet("\n\t")])).toEqual([]);
  });

  test("drops a point longer than the cap", () => {
    expect(sanitizeBullets([bullet("ก".repeat(MAX_BULLET_CHARS + 1))])).toEqual([]);
    expect(sanitizeBullets([bullet("ก".repeat(MAX_BULLET_CHARS))])).toHaveLength(1);
  });

  test("applies the FR-19 screen", () => {
    const kept = sanitizeBullets([
      bullet("ผู้ยื่นข้อเสนอต้องมีผลงานไม่น้อยกว่า 5 ปี"),
      bullet("เงื่อนไขนี้ไม่เป็นธรรมต่อผู้รับจ้าง"),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.text).toContain("ผลงาน");
  });

  test("de-duplicates — a bundle repeats the same requirement across documents", () => {
    const kept = sanitizeBullets([
      bullet("วางหลักประกันซองร้อยละ 5", 1),
      bullet("วางหลักประกันซองร้อยละ 5", 7),
      bullet("  วางหลักประกันซองร้อยละ 5  ", 9),
    ]);
    expect(kept).toHaveLength(1);
    // The first occurrence wins, so the citation points at the earliest chunk.
    expect(kept[0]?.chunkIndex).toBe(1);
  });

  test("caps the list at MAX_BULLETS", () => {
    const many = Array.from({ length: MAX_BULLETS + 5 }, (_, i) =>
      bullet(`ข้อกำหนดที่ ${i}`, i),
    );
    expect(sanitizeBullets(many)).toHaveLength(MAX_BULLETS);
  });

  test("keeps the chunkIndex, which is what makes a point traceable to a page", () => {
    const [only] = sanitizeBullets([bullet("กำหนดส่งมอบภายใน 180 วัน", 4)]);
    expect(only?.chunkIndex).toBe(4);
  });

  test("survives a non-string text field from a malformed model response", () => {
    const junk = [{ text: null, chunkIndex: 0 }] as unknown as SummaryBullet[];
    expect(sanitizeBullets(junk)).toEqual([]);
  });
});
