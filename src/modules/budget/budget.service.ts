import type { QueryFilter } from "mongoose";
import { TorModel, type Tor } from "../tor/tor.model.ts";
import { thaiFiscalYear } from "../tor/tor.service.ts";
import { lineText } from "../../lib/sources/bmaBudget/classify.ts";
import { BudgetImportModel, BudgetLineModel, type BudgetLineLean } from "./budget.model.ts";
import { matchBudget, type LineMatch, type MatchTor } from "./budget.match.ts";
import { buildBudgetInsights, type BudgetInsightsJSON, type InsightLine } from "./budget.insights.ts";

export type BudgetInsightsInput = { year?: number };

/** When a fiscal year (Buddhist era) begins and ends, as instants:
 *  1 October 00:00 Bangkok time to the next 1 October. */
export function fiscalYearWindow(year: number): { start: Date; end: Date } {
  const october = year - 544;
  return {
    start: new Date(Date.UTC(october, 9, 1) - 7 * 3_600_000),
    end: new Date(Date.UTC(october + 1, 9, 1) - 7 * 3_600_000),
  };
}

function toInsightLine(line: BudgetLineLean): InsightLine {
  return {
    id: line._id.toString(),
    agency: line.agency,
    description: lineText({ description: line.description ?? "", project: null }),
    projectTitle: line.project?.title || null,
    projectTotal: line.project?.total ?? null,
    amount: line.amount,
    workTypes: line.workTypes ?? [],
  };
}

/** The software lines of one year and the TORs that spent them. */
async function yearWithMatches(year: number): Promise<{ lines: InsightLine[]; matches: Map<string, LineMatch> }> {
  const { start, end } = fiscalYearWindow(year);
  const [lines, tors] = await Promise.all([
    BudgetLineModel.find({ year, isSoftware: true }).lean<BudgetLineLean[]>(),
    // Software TORs of that fiscal year, by the year e-GP filed them under or,
    // failing that, when they were announced. Not publicScope: a TOR that is
    // already awarded still spent its line.
    TorModel.find(
      {
        isSoftware: true,
        $or: [{ fiscalYear: year }, { fiscalYear: null, announcedAt: { $gte: start, $lt: end } }],
      } as QueryFilter<Tor>,
      { projectName: 1, agency: 1, department: 1, budget: 1, announcedAt: 1 },
    ).lean(),
  ]);

  const insightLines = lines.map(toInsightLine);
  const matchTors: MatchTor[] = tors.map((t) => ({
    id: t._id.toString(),
    title: t.projectName,
    agency: t.agency ?? null,
    department: t.department ?? null,
    budget: t.budget ?? null,
    announcedAt: t.announcedAt ?? null,
  }));
  return { lines: insightLines, matches: matchBudget(insightLines, matchTors) };
}

export async function getBudgetInsights(
  input: BudgetInsightsInput,
): Promise<BudgetInsightsJSON | { year: number; imported: false }> {
  const year = input.year ?? thaiFiscalYear();
  const record = await BudgetImportModel.findOne({ year }).lean();
  if (!record) return { year, imported: false };

  const lastRecord = await BudgetImportModel.findOne({ year: year - 1 }).lean();
  const [current, last] = await Promise.all([
    yearWithMatches(year),
    lastRecord ? yearWithMatches(year - 1) : Promise.resolve(null),
  ]);

  return buildBudgetInsights({
    year,
    status: record.status,
    source: { dataset: record.dataset, url: record.sourceUrl, importedAt: record.importedAt },
    coverage: { files: record.files.length, skipped: record.skipped.map((s) => s.name ?? s.agencyFile ?? "") },
    lines: current.lines,
    matches: current.matches,
    lastYear: last ? { year: year - 1, ...last } : null,
  });
}
