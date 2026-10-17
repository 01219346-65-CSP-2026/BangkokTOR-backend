import { biddingStatus } from "./tor.bidding.ts";

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
  if (whole === 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** Which bucket a budget falls in. Null budget → null (unpriced). */
export function budgetBand(budget: number | null): BudgetBand | null {
  if (budget === null) return null;
  if (budget < 500_000) return "under500k";
  if (budget < 5_000_000) return "500kTo5m";
  if (budget < 50_000_000) return "5mTo50m";
  return "over50m";
}

/** "YYYY-MM" of a date in Bangkok time. */
export function monthKey(date: Date): string {
  const bkk = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = bkk.getUTCFullYear();
  const month = String(bkk.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** The `count` month keys ending with now's month, oldest first. */
export function lastMonths(now: Date, count: number = MONTHS): string[] {
  const bkk = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const year = bkk.getUTCFullYear();
  const month = bkk.getUTCMonth();

  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - i, 1));
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

/**
 * A TOR a team can actually bid on: the invitation is out and the deadline
 * hasn't passed, or it's still headed toward an invitation (TOR / purchase-
 * report stage). The same open/upcoming rule tor.bidding.ts uses for the
 * public listing's bidding filter — so this dashboard and that page never
 * disagree about what counts as biddable.
 *
 * Not the same question as "is the method eBidding/competitive": a TOR can
 * carry a biddable method and still be done — awarded, under contract,
 * cancelled, or past its own deadline. Money already won isn't money a team
 * could still compete for. A null `biddingStage` reads as closed too — the
 * national/CKAN feed this project ingests carries awarded projects only (see
 * AGENTS.md), so a row from there with no stage recorded already has a
 * winner; the pipeline just never writes the word "awarded" for that source.
 */
export function isBiddable(row: Pick<InsightRow, "methodId" | "biddingStage" | "bidClosesAt">, now: Date): boolean {
  return biddingStatus(row, now) !== "closed";
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
  const totalTors = rows.length;
  const totalBudget = rows.reduce((sum, r) => sum + (r.budget ?? 0), 0);

  const biddableRows = rows.filter((r) => isBiddable(r, now));
  const biddableTors = biddableRows.length;
  const biddableBudget = biddableRows.reduce((sum, r) => sum + (r.budget ?? 0), 0);

  const provinces = new Set(rows.map((r) => r.province).filter((p): p is string => !!p));
  const bangkokTors = rows.filter((r) => r.province === BANGKOK).length;
  const openNow = rows.filter((r) => biddingStatus(r, now) === "open").length;

  const totals = {
    tors: totalTors,
    provinces: provinces.size,
    budget: totalBudget,
    biddableTors,
    biddableBudget,
    openNow,
    bangkokTors,
    bangkokShare: share(bangkokTors, totalTors),
  };

  // Graph 1: byMethod — pre-filled in METHOD_ORDER, "unknown" appended last
  // and only if it has any TORs.
  const methodCounts = new Map<InsightMethod, { tors: number; budget: number }>();
  for (const m of METHOD_ORDER) methodCounts.set(m, { tors: 0, budget: 0 });
  for (const row of rows) {
    const method: InsightMethod = (METHOD_ORDER as readonly (string | null)[]).includes(row.methodId)
      ? (row.methodId as InsightMethod)
      : "unknown";
    const entry = methodCounts.get(method) ?? { tors: 0, budget: 0 };
    entry.tors += 1;
    entry.budget += row.budget ?? 0;
    methodCounts.set(method, entry);
  }
  const byMethod: MethodSlice[] = METHOD_ORDER.map((method) => {
    const entry = methodCounts.get(method)!;
    return {
      method,
      tors: entry.tors,
      budget: entry.budget,
      torShare: share(entry.tors, totalTors),
      budgetShare: share(entry.budget, totalBudget),
    };
  });
  const unknown = methodCounts.get("unknown");
  if (unknown && unknown.tors > 0) {
    byMethod.push({
      method: "unknown",
      tors: unknown.tors,
      budget: unknown.budget,
      torShare: share(unknown.tors, totalTors),
      budgetShare: share(unknown.budget, totalBudget),
    });
  }

  // Graph 2: budgetBands — every band, in order, biddable part counted too.
  const bandCounts = new Map<BudgetBand, { tors: number; biddable: number }>();
  for (const band of BUDGET_BANDS) bandCounts.set(band, { tors: 0, biddable: 0 });
  let unpricedTors = 0;
  for (const row of rows) {
    const band = budgetBand(row.budget);
    if (band === null) {
      unpricedTors += 1;
      continue;
    }
    const entry = bandCounts.get(band)!;
    entry.tors += 1;
    if (isBiddable(row, now)) entry.biddable += 1;
  }
  const budgetBands = BUDGET_BANDS.map((band) => ({ band, ...bandCounts.get(band)! }));

  // Graph 3: topAgencies — biddable TORs only, most money first.
  const agencyCounts = new Map<string, { tors: number; budget: number }>();
  for (const row of biddableRows) {
    if (!row.agency) continue;
    const entry = agencyCounts.get(row.agency) ?? { tors: 0, budget: 0 };
    entry.tors += 1;
    entry.budget += row.budget ?? 0;
    agencyCounts.set(row.agency, entry);
  }
  const topAgencies = [...agencyCounts.entries()]
    .map(([agency, entry]) => ({ agency, ...entry }))
    .sort((a, b) => b.budget - a.budget || b.tors - a.tors || a.agency.localeCompare(b.agency))
    .slice(0, TOP_AGENCIES);

  // Graph 4: byMonth — twelve zero-filled months, oldest first.
  const months = lastMonths(now);
  const monthCounts = new Map<string, { tors: number; biddable: number }>();
  for (const month of months) monthCounts.set(month, { tors: 0, biddable: 0 });
  for (const row of rows) {
    if (!row.announcedAt) continue;
    const key = monthKey(row.announcedAt);
    const entry = monthCounts.get(key);
    if (!entry) continue;
    entry.tors += 1;
    if (isBiddable(row, now)) entry.biddable += 1;
  }
  const byMonth = months.map((month) => ({ month, ...monthCounts.get(month)! }));

  return { totals, byMethod, budgetBands, unpricedTors, topAgencies, byMonth };
}
