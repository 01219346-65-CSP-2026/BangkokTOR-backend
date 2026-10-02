import { politeFetch } from "../../http/politeClient.ts";

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
