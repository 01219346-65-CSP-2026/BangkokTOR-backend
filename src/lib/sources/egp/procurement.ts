import { politeFetch } from "../../http/politeClient.ts";
import { COL } from "../ckan/columns.ts";

// Where a project stands in e-GP's procurement flow, read from the same
// announcement micro-frontend that process5's project page uses
// (egp-oann10-service). The project SEARCH on that service is Turnstile-gated
// and is not used; these per-project lookups are not gated (verified
// 2026-10-02). Do not reach for the search from here.

const ANNOUNCEMENT = "https://process5.gprocurement.go.th/egp-oann10-service/pb/a-egp-allt-project/announcement";

export const BIDDING_STAGES = ["tor", "purchaseReport", "invitation", "awarded", "contract", "cancelled"] as const;
export type BiddingStage = (typeof BIDDING_STAGES)[number];

/**
 * e-GP's step groups (getStepGrp), by the names the flow reports:
 *   1 จัดทำ TOR · 2 รายงานขอซื้อขอจ้าง · 3 หนังสือเชิญชวน/ประกาศเชิญชวน
 *   4 อนุมัติสั่งซื้อสั่งจ้างและประกาศผู้ชนะการเสนอราคา · 5 จัดทำสัญญา/บริหารสัญญา
 * plus ยกเลิกโครงการ, which the site appends. Order matters: "ประกาศผู้ชนะ"
 * contains ประกาศ, so the invitation rule checks for เชิญชวน specifically.
 */
const STAGE_BY_NAME: Array<[RegExp, BiddingStage]> = [
  [/ยกเลิก/, "cancelled"],
  [/เชิญชวน/, "invitation"],
  [/ผู้ชนะ|อนุมัติสั่ง/, "awarded"],
  [/สัญญา/, "contract"],
  [/รายงานขอซื้อขอจ้าง|เห็นชอบ/, "purchaseReport"],
  [/TOR/i, "tor"],
];

/** Undefined for a name not seen before — recorded by the caller, never guessed. */
export function stageFromFlowName(name: string | null | undefined): BiddingStage | undefined {
  if (!name) return undefined;
  return STAGE_BY_NAME.find(([re]) => re.test(name))?.[1];
}

type Envelope<T> = { data?: T | null; response?: { responseCode?: number | string } };

async function get<T>(path: string, projectId: string): Promise<T | null> {
  const response = await politeFetch(`${ANNOUNCEMENT}/${path}?projectId=${encodeURIComponent(projectId)}`);
  const body = (await response.json()) as Envelope<T>;
  return body.data ?? null;
}

export type ProcurementState = {
  /** The raw step name, kept for audit and for an unknown-stage report. */
  flowName: string | null;
  stage: BiddingStage | undefined;
  /** e-GP's project status code: "A" active, "R" cancelled. */
  projectStatus: string | null;
  /** A status code other than those two — reported by the caller. */
  unknownProjectStatus: boolean;
  /** Buddhist-era fiscal year, e.g. 2570. */
  budgetYear: number | undefined;
};

/**
 * getProjectDetail's `projectStatus`. A cancelled project keeps the flowName of
 * the step it stopped at, so the flow alone calls it "invitation" forever.
 * Verified 2026-10-02: 69089343980 is "R" on e-GP and ยกเลิกโครงการ on the BMA
 * portal, and an active project is "A". Other codes have not been seen; they
 * are reported, not guessed.
 */
const ACTIVE = "A";
const CANCELLED = "R";

/** Null when e-GP has no such project. */
export async function procurementState(projectId: string): Promise<ProcurementState | null> {
  const [detail, project] = await Promise.all([
    get<{ flowName?: string | null }>("getProcurementDetail", projectId),
    get<{ budgetYear?: string | null; projectStatus?: string | null }>("getProjectDetail", projectId),
  ]);
  if (!detail && !project) return null;

  const flowName = detail?.flowName ?? null;
  const projectStatus = project?.projectStatus ?? null;
  const year = Number(project?.budgetYear);
  return {
    flowName,
    projectStatus,
    stage: projectStatus === CANCELLED ? "cancelled" : stageFromFlowName(flowName),
    unknownProjectStatus: projectStatus !== null && projectStatus !== ACTIVE && projectStatus !== CANCELLED,
    budgetYear: Number.isInteger(year) && year > 2500 ? year : undefined,
  };
}

// ── A captured project's record, from e-GP itself ─────────────────────────────
//
// Projects captured from e-GP's search (tools/egp-capture) arrive as bare ids.
// Their record is read here and keyed by the CKAN column names normalize.ts
// reads, like every other feed's rows (bma/columns.ts, govspending/columns.ts).

/** e-GP methodId → the method text toMethodId understands. Verified
 *  2026-10-03 against TORs whose method was known from the BMA portal. Any
 *  other code (selection's has not been seen yet) is left unset and reported. */
const METHOD_BY_ID: Record<string, string> = {
  "16": "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  "19": "เฉพาะเจาะจง",
};

/** typeId → procurement type. Only "03" (hire) has been observed. */
const TYPE_BY_ID: Record<string, string> = {
  "03": "จ้างทำของ/จ้างเหมาบริการ",
};

export type ProcurementDetail = {
  projectName?: string | null;
  deptSubName?: string | null;
  projectMoney?: number | null;
  priceBuild?: number | null;
  methodId?: string | null;
  typeId?: string | null;
  announceDate?: string | null;
  /** The buying agency — the key to its address (agencyProvince). */
  deptId?: string | null;
  deptSubId?: string | null;
};
export type ProjectDetail = { budgetYear?: string | null; deptName?: string | null };

/** "2026-08-09T17:00:00.000Z" is 10 Aug in Bangkok. */
function bangkokDay(iso: string | null | undefined): string | undefined {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** Pure mapping, so it can be checked against a recorded response. */
export function toCaptureFields(
  projectId: string,
  detail: ProcurementDetail | null,
  project: ProjectDetail | null,
  captured: { province?: string } = {},
): { fields: Record<string, unknown>; unknownMethod: string | null } {
  const methodId = detail?.methodId ?? null;
  return {
    fields: {
      [COL.projectId]: projectId,
      [COL.title]: detail?.projectName ?? undefined,
      [COL.agency]: project?.deptName ?? detail?.deptSubName ?? undefined,
      [COL.department]: detail?.deptSubName ?? undefined,
      [COL.budget]: detail?.projectMoney ?? undefined,
      [COL.referencePrice]: detail?.priceBuild ?? undefined,
      [COL.methodGroup]: methodId ? METHOD_BY_ID[methodId] : undefined,
      [COL.projectType]: detail?.typeId ? TYPE_BY_ID[detail.typeId] : undefined,
      [COL.announcedAt]: bangkokDay(detail?.announceDate),
      [COL.fiscalYear]: project?.budgetYear ?? undefined,
      [COL.province]: captured.province,
    },
    unknownMethod: methodId && !METHOD_BY_ID[methodId] ? methodId : null,
  };
}

/** Null when e-GP has no such project. */
export async function procurementFields(projectId: string, captured: { province?: string } = {}) {
  const [detail, project] = await Promise.all([
    get<ProcurementDetail>("getProcurementDetail", projectId),
    get<ProjectDetail>("getProjectDetail", projectId),
  ]);
  if (!detail && !project) return null;
  // The search row carries no province, and getProcurementDetail's
  // provinceMoiId is empty; the agency's own record has its location.
  const province = captured.province ?? (await agencyProvince(detail?.deptId, detail?.deptSubId));
  return toCaptureFields(projectId, detail, project, { province });
}

// ── Where the buying agency is ───────────────────────────────────────────────
//
// e-GP's reference-data service (egp-rdb-service), the same lookups the
// announcement page makes, not gated (verified 2026-10-03):
//   infoDeptSub?deptId&deptSubId → deptSubMoiId "300101" (ministry-of-interior
//                                   location: province 30, district 01, …)
//   rdbsysm011/listProvince      → all 77, provinceMoiId "300000" → นครราชสีมา
// A province is the first two digits of a MOI code, padded to six.

const RDB = "https://process5.gprocurement.go.th/egp-rdb-service";

type ProvinceRow = { provinceMoiId: string; provinceName: string };

/** Pure: a MOI location code → province name, or undefined. */
export function provinceFromMoiId(moiId: string | null | undefined, provinces: Map<string, string>): string | undefined {
  const code = String(moiId ?? "").trim();
  if (!/^\d{2}/.test(code)) return undefined;
  return provinces.get(`${code.slice(0, 2)}0000`);
}

let provinceCache: Promise<Map<string, string>> | null = null;

/** e-GP's province list, fetched once per process. */
export function egpProvinces(): Promise<Map<string, string>> {
  provinceCache ??= (async () => {
    const response = await politeFetch(`${RDB}/rdbsysm011/listProvince`);
    const rows = ((await response.json()) as { data?: ProvinceRow[] }).data ?? [];
    return new Map(rows.map((r) => [r.provinceMoiId.trim(), r.provinceName.trim()]));
  })().catch((error) => {
    provinceCache = null; // a failed fetch is retried next time, not cached
    throw error;
  });
  return provinceCache;
}

/** The province of a buying agency, or undefined if e-GP does not say. */
export async function agencyProvince(deptId?: string | null, deptSubId?: string | null): Promise<string | undefined> {
  if (!deptId || !deptSubId) return undefined;
  const response = await politeFetch(
    `${RDB}/infoDeptSub?deptId=${encodeURIComponent(deptId.trim())}&deptSubId=${encodeURIComponent(deptSubId.trim())}`,
  );
  const data = ((await response.json()) as { data?: { deptSubMoiId?: string | null; principalMoiId?: string | null } }).data;
  const provinces = await egpProvinces();
  return provinceFromMoiId(data?.deptSubMoiId, provinces) ?? provinceFromMoiId(data?.principalMoiId, provinces);
}
