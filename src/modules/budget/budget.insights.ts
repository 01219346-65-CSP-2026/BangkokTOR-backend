import type { LineMatch } from "./budget.match.ts";

// The dashboard's budget panel: Bangkok's approved software budget for a
// fiscal year, and how much of it has turned into TORs.
//
// Pure (§4.5), like tor.insights.ts: lines and matches in, numbers out.
//
// FR-19: these are market numbers — what was appropriated, what has been
// tendered, what is still to come. Money with no TOR yet is "not announced
// yet", an opportunity for a bidder; it is never "unspent", "late" or
// "underperforming", and nothing here ranks an agency by how little of its
// budget it has tendered. Agencies are ordered by the size of their budget.

/** A software budget line, as much of it as the panel needs. */
export type InsightLine = {
  id: string;
  agency: string;
  description: string;
  projectTitle: string | null;
  projectTotal: number | null;
  amount: number;
  workTypes: string[];
};

/** Above this a BMA purchase normally goes to e-bidding; at or below it a
 *  direct award (เฉพาะเจาะจง) is allowed — พ.ร.บ.การจัดซื้อจัดจ้างฯ 2560
 *  ม.56(2)(ข) and its กฎกระทรวง. A hint for the reader, not a prediction. */
export const DIRECT_AWARD_LIMIT = 500_000;
export const TOP_UPCOMING = 20;

export type BudgetInsightsJSON = {
  year: number;
  imported: true;
  status: "draft" | "enacted";
  source: { dataset: string; url: string; importedAt: Date };
  /** Agency workbooks read, and the ones that could not be (old .xls…). */
  coverage: { files: number; skipped: string[] };
  totals: {
    lines: number;
    budget: number;
    tenderedLines: number;
    tenderedBudget: number;
    /** budget − tenderedBudget: approved, no TOR announced yet. */
    toComeBudget: number;
    /** Percent tendered, one decimal. */
    tenderedShare: number;
  };
  /** Every agency with software lines, biggest budget first. */
  agencies: Array<{ agency: string; lines: number; budget: number; tenderedBudget: number }>;
  /** Lines with no TOR yet, biggest first, at most TOP_UPCOMING. */
  upcoming: Array<{
    id: string;
    agency: string;
    title: string;
    amount: number;
    projectTotal: number | null;
    likelyMethod: "eBidding" | "specific";
    workTypes: string[];
  }>;
  upcomingTotal: number;
  /** Last year's pace: cumulative percent of its software budget tendered by
   *  the end of each fiscal month (Oct → Sep). Null when last year isn't
   *  imported. */
  timing: { year: number; months: Array<{ month: string; share: number }>; matchedLines: number } | null;
};

export const share = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

/** What the upcoming list calls a line: the project's name when it has one
 *  (that is what the TOR will be titled), else the line's own words. */
export function displayTitle(line: Pick<InsightLine, "description" | "projectTitle">): string {
  const raw = line.projectTitle || line.description;
  return raw.replace(/^\(\d+\)\s*/, "").replace(/^-\s*/, "").trim();
}

/** "2026-10" … "2027-09" for fiscal year 2570 (1 Oct 2026 – 30 Sep 2027). */
export function fiscalMonths(year: number): string[] {
  const start = year - 544; // the Gregorian year October falls in
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(start, 9 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** "YYYY-MM" of a date in Bangkok time. */
function bangkokMonth(date: Date): string {
  const d = new Date(date.getTime() + 7 * 3_600_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildTiming(
  year: number,
  lines: InsightLine[],
  matches: Map<string, LineMatch>,
): NonNullable<BudgetInsightsJSON["timing"]> {
  const months = fiscalMonths(year);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  const perMonth = new Map(months.map((m) => [m, 0]));
  let matchedLines = 0;
  for (const line of lines) {
    const m = matches.get(line.id);
    if (!m) continue;
    matchedLines++;
    // A line tendered before its fiscal year began (a TOR can be prepared in
    // advance) counts in the first month; one with no date is left out.
    if (!m.firstAnnouncedAt) continue;
    const key = bangkokMonth(m.firstAnnouncedAt);
    const month = key < months[0]! ? months[0]! : key;
    if (perMonth.has(month)) perMonth.set(month, perMonth.get(month)! + m.tenderedAmount);
  }
  let running = 0;
  return {
    year,
    matchedLines,
    months: months.map((month) => {
      running += perMonth.get(month)!;
      return { month, share: share(running, total) };
    }),
  };
}

export function buildBudgetInsights(input: {
  year: number;
  status: "draft" | "enacted";
  source: BudgetInsightsJSON["source"];
  coverage: BudgetInsightsJSON["coverage"];
  lines: InsightLine[];
  matches: Map<string, LineMatch>;
  lastYear: { year: number; lines: InsightLine[]; matches: Map<string, LineMatch> } | null;
}): BudgetInsightsJSON {
  const { lines, matches } = input;
  const tendered = (l: InsightLine) => matches.get(l.id)?.tenderedAmount ?? 0;

  const budget = lines.reduce((s, l) => s + l.amount, 0);
  const tenderedBudget = lines.reduce((s, l) => s + tendered(l), 0);

  const byAgency = new Map<string, { lines: number; budget: number; tenderedBudget: number }>();
  for (const line of lines) {
    const a = byAgency.get(line.agency) ?? { lines: 0, budget: 0, tenderedBudget: 0 };
    a.lines += 1;
    a.budget += line.amount;
    a.tenderedBudget += tendered(line);
    byAgency.set(line.agency, a);
  }
  const agencies = [...byAgency.entries()]
    .map(([agency, a]) => ({ agency, ...a }))
    .sort((a, b) => b.budget - a.budget || a.agency.localeCompare(b.agency));

  const open = lines.filter((l) => !matches.has(l.id)).sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const upcoming = open.slice(0, TOP_UPCOMING).map((l) => ({
    id: l.id,
    agency: l.agency,
    title: displayTitle(l),
    amount: l.amount,
    projectTotal: l.projectTotal,
    likelyMethod: l.amount > DIRECT_AWARD_LIMIT ? ("eBidding" as const) : ("specific" as const),
    workTypes: l.workTypes,
  }));

  return {
    year: input.year,
    imported: true,
    status: input.status,
    source: input.source,
    coverage: input.coverage,
    totals: {
      lines: lines.length,
      budget,
      tenderedLines: lines.filter((l) => matches.has(l.id)).length,
      tenderedBudget,
      toComeBudget: budget - tenderedBudget,
      tenderedShare: share(tenderedBudget, budget),
    },
    agencies,
    upcoming,
    upcomingTotal: open.length,
    timing: input.lastYear ? buildTiming(input.lastYear.year, input.lastYear.lines, input.lastYear.matches) : null,
  };
}
