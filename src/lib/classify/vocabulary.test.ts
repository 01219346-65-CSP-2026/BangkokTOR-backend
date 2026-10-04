import { describe, expect, test } from "bun:test";
import { toStatusId } from "./vocabulary.ts";

// The two values datagoth actually ships after realignment (FY2568 sample,
// 2026-09-30), plus the ones the vocabulary has always known.
describe("toStatusId", () => {
  test("a running contract is in progress", () => {
    expect(toStatusId("ระหว่างดำเนินการ")).toBe("inProgress");
  });

  test("an ended contract is finished, not 'contract issued'", () => {
    expect(toStatusId("สิ้นสุดสัญญา")).toBe("contractEnded");
  });

  test("delivery states keep their own ids", () => {
    expect(toStatusId("ส่งงานครบถ้วน")).toBe("deliveredComplete");
    expect(toStatusId("ส่งงานตามกำหนด")).toBe("deliveredOnTime");
  });

  test("absent stays absent", () => {
    expect(toStatusId(null)).toBeNull();
    expect(toStatusId("")).toBeNull();
  });
});
