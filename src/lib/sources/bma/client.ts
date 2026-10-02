import { politeFetch } from "../../http/politeClient.ts";

// egp2.bangkok.go.th — the Bangkok Metropolitan Administration's own e-GP
// portal (AGENTS.md §3, Source A). Unlike process5's announcement search it
// is not behind Cloudflare Turnstile, and unlike the national bulk exports it
// lists projects the day they are announced, so it is the one place an OPEN
// tender can be discovered. Verified live 2026-10-02.
//
// `projectId` here is the portal's own uuid; `projectNumber` is the e-GP
// project id that everything else in the pipeline is keyed on.

export const BMA_API = "https://egp2.bangkok.go.th/appapi/api";
export const BMA_FILES = "https://egp2.bangkok.go.th/api/file";

export type BmaPage<T> = {
  totalCount: number;
  hasNextPage: boolean;
  data: T[];
};

/** One row of GetProjectFromFilter. */
export type BmaListRow = {
  projectId: string;
  projectNumber: string;
  projectName: string;
  masterOrgGroupName: string | null;
  masterOrgDepartmentName: string | null;
  projectBudget: number | null;
  masterContractAvailableCode: string | null;
};

/** GetProjectDetail — the list row plus procurement method, type and ราคากลาง. */
export type BmaDetail = BmaListRow & {
  masterContractAvailableName: string | null;
  masterTypeIdName: string | null;
  masterGoodsIdName: string | null;
  masterMethodIdName: string | null;
  projectAverageBudget: number | null;
};

export type BmaAnnouncement = {
  id: string;
  masterAnnounceTypeName: string | null;
  /** ISO instant. A calendar date in Bangkok, shipped as 17:00Z the day before. */
  projectAnnouncementPublishDate: string | null;
  /** Thai filename. Null when nothing was attached. */
  projectAnnouncementPath: string | null;
};

/** The ประกาศเชิญชวน — the document that states the bid date. */
export const INVITATION = "ประกาศเชิญชวน";

export const BMA_PAGE_SIZE = 200;

async function getJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const response = await politeFetch(`${BMA_API}/${path}?${new URLSearchParams(params)}`);
  return (await response.json()) as T;
}

/** Newest first. The portal's date filters do not work (AGENTS.md §3); sort order does. */
export function searchPage(pageNo: number, pageSize = BMA_PAGE_SIZE): Promise<BmaPage<BmaListRow>> {
  return getJson("Projects/GetProjectFromFilter", {
    pageNo: String(pageNo),
    pageSize: String(pageSize),
    sortBy: "publishDateDesc",
  });
}

export function projectDetail(uuid: string): Promise<BmaDetail> {
  return getJson("Projects/GetProjectDetail", { projectId: uuid });
}

export async function announcements(uuid: string): Promise<BmaAnnouncement[]> {
  const page = await getJson<BmaPage<BmaAnnouncement>>("ProjectAnnouncements/GetAnnouncementDetailInProject", {
    projectId: uuid,
    pageNo: "1",
    pageSize: "50",
  });
  return page.data ?? [];
}

/** The file itself. The filename is Thai and must be percent-encoded. */
export function fileUrl(a: BmaAnnouncement): string | null {
  if (!a.projectAnnouncementPath) return null;
  return `${BMA_FILES}/${a.id}/${encodeURIComponent(a.projectAnnouncementPath)}`;
}

/**
 * The invitation the deadline should come from: the most recently published
 * one with a file. A project re-announced after a failed round carries several,
 * and only the newest date is the live one.
 */
export function latestInvitation(list: BmaAnnouncement[]): BmaAnnouncement | null {
  const invitations = list
    .filter((a) => a.masterAnnounceTypeName?.trim() === INVITATION && a.projectAnnouncementPath)
    .sort((a, b) => (b.projectAnnouncementPublishDate ?? "").localeCompare(a.projectAnnouncementPublishDate ?? ""));
  return invitations[0] ?? null;
}
