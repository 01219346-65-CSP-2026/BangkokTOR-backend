import { describe, expect, test } from "bun:test";
import { MAX_CHUNKS_PER_RULE, routeChunks, unroutedRules } from "./route.ts";
import type { GradeChunk, RuleSpec } from "./types.ts";

const penalty: RuleSpec = {
  code: "PENALTY",
  definition: "a monetary fine for late performance",
  cues: ["ค่าปรับ", "ปรับวันละ"],
};
const ipgrab: RuleSpec = {
  code: "IPGRAB",
  definition: "assignment of intellectual property",
  cues: ["ลิขสิทธิ์", "ทรัพย์สินทางปัญญา"],
};

const chunk = (index: number, text: string, headingPath: string[] = []): GradeChunk => ({
  index,
  headingPath,
  text,
});

describe("routeChunks", () => {
  test("sends a rule only to chunks that mention its cues", () => {
    const chunks = [
      chunk(0, "รถโดยสารมาตรฐาน จำนวน ๓๑๑ คัน"),
      chunk(1, "ให้คิดค่าปรับวันละ ๑,๐๐๐ บาท"),
    ];
    const calls = routeChunks([penalty], chunks);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.chunk.index).toBe(1);
  });

  test("a heading match outranks a passing mention in the body", () => {
    const calls = routeChunks(
      [penalty],
      [
        chunk(0, "อ้างถึงค่าปรับในข้อ ๗", ["๑. บททั่วไป"]),
        chunk(1, "รายละเอียดตามที่กำหนด", ["๗. ค่าปรับ"]),
      ],
    );
    // The section actually titled "ค่าปรับ" should be asked first.
    expect(calls[0]!.chunk.index).toBe(1);
  });

  test("caps the number of chunks per rule", () => {
    const many = Array.from({ length: 12 }, (_, i) => chunk(i, "ค่าปรับวันละ"));
    expect(routeChunks([penalty], many)).toHaveLength(MAX_CHUNKS_PER_RULE);
  });

  test("routes each rule independently", () => {
    const chunks = [chunk(0, "ค่าปรับวันละ"), chunk(1, "ลิขสิทธิ์ทั้งหมด")];
    const calls = routeChunks([penalty, ipgrab], chunks);

    expect(calls.filter((c) => c.rule.code === "PENALTY")[0]!.chunk.index).toBe(0);
    expect(calls.filter((c) => c.rule.code === "IPGRAB")[0]!.chunk.index).toBe(1);
  });

  test("a rule matching nothing produces no calls — and is reported unrouted", () => {
    // The distinction that matters: never checked is not the same as passed.
    const calls = routeChunks([ipgrab], [chunk(0, "ค่าปรับวันละ")]);
    expect(calls).toHaveLength(0);
    expect(unroutedRules([ipgrab], calls).map((r) => r.code)).toEqual(["IPGRAB"]);
  });

  test("routing cuts the call count well below rules x chunks", () => {
    const chunks = Array.from({ length: 24 }, (_, i) =>
      chunk(i, i === 3 ? "ค่าปรับวันละ" : "ข้อความทั่วไปเกี่ยวกับงาน"),
    );
    const calls = routeChunks([penalty, ipgrab], chunks);
    // Unrouted, this would be 2 x 24 = 48 model calls.
    expect(calls.length).toBeLessThan(5);
  });
});
