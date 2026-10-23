import { describe, expect, test } from "bun:test";
import { BANGKOK_DISTRICTS, normalizeBangkokDistrict } from "./bangkokDistricts.ts";

describe("BANGKOK_DISTRICTS", () => {
  test("all 50 khet, codes 01–50 in order, names unique", () => {
    expect(BANGKOK_DISTRICTS).toHaveLength(50);
    expect(BANGKOK_DISTRICTS.map((d) => d.code)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
    expect(new Set(BANGKOK_DISTRICTS.map((d) => d.th)).size).toBe(50);
    expect(new Set(BANGKOK_DISTRICTS.map((d) => d.en)).size).toBe(50);
  });
});

describe("normalizeBangkokDistrict", () => {
  test("the bare Thai name the feeds store", () => {
    expect(normalizeBangkokDistrict("หลักสี่")).toBe("41");
    expect(normalizeBangkokDistrict("พระนคร")).toBe("01");
  });

  test("with the เขต prefix and stray spaces", () => {
    expect(normalizeBangkokDistrict("เขตจตุจักร")).toBe("30");
    expect(normalizeBangkokDistrict(" เขต ปทุมวัน ")).toBe("07");
  });

  test("English, any case, with Khet/District around it", () => {
    expect(normalizeBangkokDistrict("Khet Bang Rak")).toBe("04");
    expect(normalizeBangkokDistrict("WATTHANA district")).toBe("39");
    expect(normalizeBangkokDistrict("Vadhana")).toBe("39");
  });

  test("known misspellings", () => {
    expect(normalizeBangkokDistrict("ราษฏร์บูรณะ")).toBe("24");
  });

  test("not a Bangkok khet → null", () => {
    expect(normalizeBangkokDistrict("ตรอน")).toBeNull(); // an อำเภอ in Uttaradit
    expect(normalizeBangkokDistrict("")).toBeNull();
    expect(normalizeBangkokDistrict(null)).toBeNull();
  });
});
