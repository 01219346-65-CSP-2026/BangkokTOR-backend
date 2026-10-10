// TODO(116) step 2: you will need biddingStatus from "./tor.bidding.ts" for openNow.

// The dashboard's insight graphs, computed from the listed TORs.
//
// Pure (§4.5), like tor.preview.ts: rows in, numbers out. The service loads
// the public scope (a few thousand rows, eight small fields each) and hands it
// here, so every figure on the dashboard comes from ONE query and one pass —
// and every figure can be tested without a database.
//
// FR-19: these are market numbers — how many, how much, where, when. Nothing
// here reads a grade, a rule finding or a signal, and nothing ranks a named
// agency by anything but what it spends. "Agencies with the most signals" is
// exactly the accusatory shape AGENTS.md §1 forbids; do not add it.

/** One listed TOR, as much of it as the graphs need. */
export type InsightRow = {
  methodId: string | null;
  budget: number | null;
  province: string | null;
  agency: string | null;
  announcedAt: Date | null;
  biddingStage: string | null;
  bidClosesAt: Date | null;
};

export const BANGKOK = "กรุงเทพมหานคร";

/** e-bidding and selection: the methods an outside team can bid on. */
export const BIDDABLE_METHODS = ["eBidding", "competitive"] as const;

/** Graph 1's order: the big-count, small-money slice first, as in the slides. */
export const METHOD_ORDER = ["specific", "eBidding", "competitive"] as const;
export type InsightMethod = (typeof METHOD_ORDER)[number] | "unknown";

/** Graph 2's buckets, in THB. Lower bound inclusive, upper bound exclusive. */
export const BUDGET_BANDS = ["under500k", "500kTo5m", "5mTo50m", "over50m"] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

export const TOP_AGENCIES = 8;
export const MONTHS = 12;

export type MethodSlice = {
  method: InsightMethod;
  tors: number;
  budget: number;
  /** Percent of all TORs, one decimal. */
  torShare: number;
  /** Percent of all budget, one decimal. */
  budgetShare: number;
};

export type InsightsJSON = {
  totals: {
    tors: number;
    /** Distinct provinces with at least one TOR. */
    provinces: number;
    budget: number;
    biddableTors: number;
    biddableBudget: number;
    /** Bids being taken right now — tor.bidding.ts's "open". */
    openNow: number;
    bangkokTors: number;
    /** Percent of TORs from Bangkok, one decimal. */
    bangkokShare: number;
  };
  byMethod: MethodSlice[];
  budgetBands: Array<{ band: BudgetBand; tors: number; biddable: number }>;
  /** TORs with no budget — left out of budgetBands, counted here instead. */
  unpricedTors: number;
  topAgencies: Array<{ agency: string; tors: number; budget: number }>;
  byMonth: Array<{ month: string; tors: number; biddable: number }>;
};

const BANGKOK_OFFSET_MS = 7 * 3_600_000;

// ─── Step 1: helpers ────────────────────────────────────────────────────────

/** part / whole as a percent with one decimal. 0 when whole is 0. */
export function share(part: number, whole: number): number {
  // TODO(116) step 1. Hint: one decimal = multiply by 1000, Math.round, divide by 10.
  throw new Error("TODO(116): share");
}

/** Which bucket a budget falls in. Null budget → null (unpriced). */
export function budgetBand(budget: number | null): BudgetBand | null {
  // TODO(116) step 1. Hint: check null first, then the bounds from smallest up.
  // Lower bound inclusive, upper exclusive: 500_000 is "500kTo5m", not "under500k".
  throw new Error("TODO(116): budgetBand");
}

/** "YYYY-MM" of a date in Bangkok time. */
export function monthKey(date: Date): string {
  // TODO(116) step 1. Hint: shift the timestamp by BANGKOK_OFFSET_MS, then read
  // it with getUTCFullYear / getUTCMonth (which is 0-based!). padStart(2, "0").
  // thaiFiscalYear() in tor.service.ts uses the same trick.
  throw new Error("TODO(116): monthKey");
}

/** The `count` month keys ending with now's month, oldest first. */
export function lastMonths(now: Date, count: number = MONTHS): string[] {
  // TODO(116) step 1. Hint: Date.UTC(year, month - back, 1) handles a negative
  // month for you — Date.UTC(2026, -1, 1) is 1 Dec 2025.
  throw new Error("TODO(116): lastMonths");
}

/** e-bidding or selection. A direct award ("specific") is not biddable. */
export function isBiddable(row: Pick<InsightRow, "methodId">): boolean {
  // TODO(116) step 2. One line with BIDDABLE_METHODS.
  throw new Error("TODO(116): isBiddable");
}

// ─── Steps 2–6: the graphs ──────────────────────────────────────────────────

/**
 * Every number on the dashboard, from one pass over the rows.
 *
 * Build it a section at a time, in test order: totals (step 2), byMethod
 * (step 3), budgetBands + unpricedTors (step 4), topAgencies (step 5),
 * byMonth (step 6). Return placeholder values for the sections you have not
 * reached yet (0, [], …) so the earlier tests can go green first.
 *
 * Patterns worth knowing here:
 *  - Map<key, { tors, budget }> as a counter, pre-filled when every key must
 *    appear even at zero (methods, bands, months).
 *  - `row.budget ?? 0` when summing money: an unknown budget adds nothing.
 *  - sort((a, b) => b.budget - a.budget || b.tors - a.tors || …) chains
 *    tie-breakers, because 0 is falsy.
 */
export function buildInsights(rows: InsightRow[], now: Date = new Date()): InsightsJSON {
  // TODO(116) steps 2–6.
  throw new Error("TODO(116): buildInsights");
}
