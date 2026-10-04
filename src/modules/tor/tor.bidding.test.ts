import { describe, expect, test } from "bun:test";
import { biddingStatus } from "./tor.bidding.ts";
import { thaiFiscalYear } from "./tor.service.ts";

const NOW = new Date("2026-10-02T05:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe("biddingStatus", () => {
  test("an invitation before its deadline is open", () => {
    expect(biddingStatus({ biddingStage: "invitation", bidClosesAt: day(18) }, NOW)).toBe("open");
  });

  // The stage says bids are being taken; the date just could not be read yet.
  test("an invitation with no readable deadline is still open", () => {
    expect(biddingStatus({ biddingStage: "invitation", bidClosesAt: null }, NOW)).toBe("open");
  });

  test("an invitation past its deadline is closed", () => {
    expect(biddingStatus({ biddingStage: "invitation", bidClosesAt: day(-1) }, NOW)).toBe("closed");
  });

  test("TOR and purchase-report stages are upcoming", () => {
    expect(biddingStatus({ biddingStage: "tor" }, NOW)).toBe("upcoming");
    expect(biddingStatus({ biddingStage: "purchaseReport" }, NOW)).toBe("upcoming");
  });

  // Kept as TOR data, but nobody outside can bid on a direct award.
  test("a direct award is closed at every stage", () => {
    expect(biddingStatus({ methodId: "specific", biddingStage: "invitation", bidClosesAt: day(5) }, NOW)).toBe("closed");
    expect(biddingStatus({ methodId: "specific", biddingStage: "tor" }, NOW)).toBe("closed");
  });

  test("awarded, contracted and never-checked are closed", () => {
    expect(biddingStatus({ biddingStage: "awarded", bidClosesAt: day(5) }, NOW)).toBe("closed");
    expect(biddingStatus({ biddingStage: "contract" }, NOW)).toBe("closed");
    expect(biddingStatus({}, NOW)).toBe("closed");
  });
});

describe("thaiFiscalYear", () => {
  test("turns over on 1 October, Bangkok time", () => {
    expect(thaiFiscalYear(new Date("2026-09-30T16:59:00Z"))).toBe(2569);
    expect(thaiFiscalYear(new Date("2026-09-30T17:00:00Z"))).toBe(2570);
    expect(thaiFiscalYear(new Date("2026-03-01T00:00:00Z"))).toBe(2569);
  });
});
