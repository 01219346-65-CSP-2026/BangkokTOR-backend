import { BANGKOK, COL } from "../ckan/columns.ts";
import type { BmaAnnouncement, BmaDetail } from "./client.ts";

// BMA fields → the CKAN column names normalize.ts already reads, the same move
// govspending/columns.ts makes. Translating at the edge keeps one normalizer
// and one classifier for every feed.
//
// CKAN files the method pair crossed (see govspending/columns.ts):
// วิธีจัดซื้อฯ holds the goods grouping and กลุ่มวิธีจัดซื้อฯ the method.
// The BMA values are placed to land the same way.

/** Where the portal's own uuid rides in `fields`, for the bidding check. */
export const BMA_ID_FIELD = "bmaProjectId";

/** "2026-09-06T17:00:00Z" is 7 Sep in Bangkok. Returns "YYYY-MM-DD" (CE). */
export function bangkokDay(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  return new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** The earliest announcement is when the project first went public. */
export function firstAnnounced(list: BmaAnnouncement[]): string | undefined {
  const days = list.map((a) => bangkokDay(a.projectAnnouncementPublishDate)).filter((d): d is string => !!d);
  return days.sort()[0];
}

export function toCkanFields(detail: BmaDetail, list: BmaAnnouncement[]): Record<string, unknown> {
  return {
    [COL.projectId]: detail.projectNumber,
    [COL.title]: detail.projectName,
    [COL.projectType]: detail.masterTypeIdName,
    [COL.agency]: detail.masterOrgGroupName,
    [COL.department]: detail.masterOrgDepartmentName,
    [COL.method]: detail.masterGoodsIdName,
    [COL.methodGroup]: detail.masterMethodIdName,
    [COL.budget]: detail.projectBudget,
    [COL.referencePrice]: detail.projectAverageBudget,
    [COL.announcedAt]: firstAnnounced(list),
    // Every agency on this portal belongs to the BMA.
    [COL.province]: BANGKOK,
    [COL.status]: detail.masterContractAvailableName,
    [BMA_ID_FIELD]: detail.projectId,
  };
}

/**
 * e-GP project numbers open with the Buddhist-era year and month they were
 * created: "69099316505" → 2569-09 → September 2026. List rows carry no date,
 * so this is the only clock discovery has. Undefined for anything malformed.
 */
export function createdMonth(projectNumber: string): Date | undefined {
  const m = /^(\d{2})(\d{2})\d{7}$/.exec(projectNumber);
  if (!m) return undefined;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return undefined;
  return new Date(Date.UTC(2500 + Number(m[1]) - 543, month - 1, 1));
}
