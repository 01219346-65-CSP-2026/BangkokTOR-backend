import { describe, expect, test } from "bun:test";
import { routeRules } from "./route.ts";
import type { RuleSpec } from "./types.ts";

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

describe("routeRules", () => {
  test("routes a rule whose cues appear in the text", () => {
    const { routed, unrouted } = routeRules([penalty], "ให้คิดค่าปรับวันละ ๑,๐๐๐ บาท");
    expect(routed.map((r) => r.code)).toEqual(["PENALTY"]);
    expect(unrouted).toHaveLength(0);
  });

  test("a rule with no cue in the text is unrouted, never silently dropped", () => {
    const { routed, unrouted } = routeRules([penalty, ipgrab], "ค่าปรับวันละ");
    expect(routed.map((r) => r.code)).toEqual(["PENALTY"]);
    expect(unrouted.map((r) => r.code)).toEqual(["IPGRAB"]);
  });

  test("every rule lands in exactly one bucket", () => {
    const { routed, unrouted } = routeRules([penalty, ipgrab], "รถโดยสารมาตรฐาน จำนวน ๓๑๑ คัน");
    expect(routed).toHaveLength(0);
    expect(unrouted).toHaveLength(2);
  });
});
