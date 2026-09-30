import { classifySoftware, classifyTor, toCategoryId, toContractId, type Classification } from "../../lib/classify/index.ts";
import { COL } from "../../lib/sources/ckan/columns.ts";
import { normalizeCkanRow, normalizeExtras } from "../../lib/sources/ckan/normalize.ts";
import type { CanonicalTor, RawProject } from "../../lib/sources/types.ts";

// What BangkokTOR keeps: software development work from the fiscal year being
// ingested. Everything else is dropped at discovery, before it costs a queue
// row, a bundle download, an extraction or a grade.
//
// Pure — row in, verdict out — so discovery, the worker, and the purge script
// all apply the same rule, and a test can check it without a database.

export type Classified = {
  canonical: CanonicalTor;
  extras: ReturnType<typeof normalizeExtras>;
  classification: Classification;
};

export function classifyRaw(raw: RawProject): Classified {
  const canonical = normalizeCkanRow(raw);
  const extras = normalizeExtras(raw);

  // Portal Thai free text into the vocabulary the dashboard filters by.
  const classification = classifyTor({
    projectName: canonical.projectName,
    goodsCategory: canonical.goodsCategory,
    procurementType: extras.procurementType,
    procurementMethod: canonical.procurementMethod,
    projectStatus: extras.projectStatus,
  });

  return { canonical, extras, classification };
}

/**
 * The software verdict alone, read straight off the raw row — no date parsing,
 * no coordinates, no Thai-digit conversion. Discovery drops ~99% of a year's
 * 4.4M rows, and normalizing each one first was most of the scan's cost.
 *
 * Must agree with classifyRaw's isSoftware exactly: it reads the same columns
 * with the same trimming and "-"-means-absent rule. Every column it reads sits
 * before จังหวัด, where CKAN's phantom-column shift does not reach, so it holds
 * for unaligned CKAN rows too. scope.test.ts checks the agreement.
 */
export function isSoftwareCandidate(raw: RawProject): boolean {
  const read = (key: string) => {
    const v = raw.fields[key];
    const s = v === null || v === undefined ? "" : String(v).trim();
    return s === "" || s === "-" ? undefined : s;
  };
  const title = read(COL.title) ?? "";
  const goodsCategory = read(COL.method);
  const procurementType = read(COL.projectType);

  return classifySoftware({
    title,
    goodsCategory,
    procurementType,
    category: toCategoryId(goodsCategory),
    contractType: toContractId(procurementType),
  }).isSoftware;
}

export type ScopeVerdict = "in-scope" | "not-software" | "other-year";

/**
 * `fiscalYear` undefined skips the year check — CKAN already filtered on it
 * server-side during discovery, and a stale queue row is the only thing that
 * could disagree.
 */
export function scopeOf(c: Classified, fiscalYear?: number): ScopeVerdict {
  if (fiscalYear !== undefined && c.extras.fiscalYear !== fiscalYear) return "other-year";
  return c.classification.isSoftware ? "in-scope" : "not-software";
}
