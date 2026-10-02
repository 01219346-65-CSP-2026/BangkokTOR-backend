import { describe, expect, test } from "bun:test";
import { classifyRaw } from "../../../modules/ingest/scope.ts";
import { COL } from "../ckan/columns.ts";
import { stageFromFlowName } from "../egp/procurement.ts";
import type { BmaAnnouncement, BmaDetail, BmaListRow, BmaPage } from "./client.ts";
import { latestInvitation, fileUrl } from "./client.ts";
import { BMA_ID_FIELD, bangkokDay, createdMonth, toCkanFields } from "./columns.ts";
import { discoverBma, isTitleCandidate } from "./discover.ts";

// Recorded from egp2.bangkok.go.th, 2026-10-02.
const DETAIL: BmaDetail = {
  projectId: "0819610c-d00d-45aa-8527-abecf9bfdc83",
  projectNumber: "69099316505",
  projectName:
    "ประกวดราคาจ้างบำรุงรักษาระบบเครือข่ายและโปรแกรมประยุกต์ ตามโครงการพัฒนาระบบศูนย์รับคำขออนุญาตของกรุงเทพมหานคร (BMA OSS)",
  masterOrgGroupName: "สำนักดิจิทัลกรุงเทพมหานคร",
  masterOrgDepartmentName: "สำนักงานพัฒนาระบบสารสนเทศดิจิทัล",
  projectBudget: 7087000,
  masterContractAvailableCode: "S1",
  masterContractAvailableName: "ระหว่างดำเนินการ",
  masterTypeIdName: "จ้างทำของ/จ้างเหมาบริการ",
  masterGoodsIdName: "จ้างเหมาอื่นๆ",
  masterMethodIdName: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
  projectAverageBudget: 7087000,
};

const ANNOUNCEMENTS: BmaAnnouncement[] = [
  {
    id: "922f8907-f7f2-4fcf-ad88-8670b881e05d",
    masterAnnounceTypeName: "ร่างเอกสารประกวดราคา (e-Bidding) และร่างเอกสารซื้อหรือจ้างด้วยวิธีสอบราคา",
    projectAnnouncementPublishDate: "2026-09-23T17:00:00Z",
    projectAnnouncementPath: "Scan_2026_07_02_18_13_56_552_1790238400650.pdf",
  },
  {
    id: "3129864f-07ea-4389-81b2-37b540a3d4fe",
    masterAnnounceTypeName: "ประกาศเชิญชวน",
    projectAnnouncementPublishDate: "2026-09-30T17:00:00Z",
    projectAnnouncementPath: "ประกาศเชิญชวน_1790846137111.pdf",
  },
];

describe("BMA columns", () => {
  test("a detail lands under the CKAN names, in Bangkok", () => {
    const fields = toCkanFields(DETAIL, ANNOUNCEMENTS);
    expect(fields[COL.projectId]).toBe("69099316505");
    expect(fields[COL.province]).toBe("กรุงเทพมหานคร");
    expect(fields[COL.announcedAt]).toBe("2026-09-24");
    expect(fields[BMA_ID_FIELD]).toBe(DETAIL.projectId);
  });

  test("normalizes and classifies like any other feed row", () => {
    const c = classifyRaw({ projectId: "69099316505", fields: toCkanFields(DETAIL, ANNOUNCEMENTS) });
    expect(c.canonical.agency).toBe("สำนักดิจิทัลกรุงเทพมหานคร");
    expect(c.canonical.budget).toBe(7087000);
    expect(c.canonical.announcedAt?.toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(c.classification.methodId).toBe("eBidding");
    expect(c.classification.isSoftware).toBe(true);
    expect(c.extras.bmaProjectId).toBe(DETAIL.projectId);
  });

  test("bangkokDay turns 17:00Z into the next calendar day", () => {
    expect(bangkokDay("2026-09-30T17:00:00Z")).toBe("2026-10-01");
    expect(bangkokDay(null)).toBeUndefined();
  });

  test("createdMonth reads the BE year and month off a project number", () => {
    expect(createdMonth("69099316505")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(createdMonth("68129550693")?.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(createdMonth("abc")).toBeUndefined();
  });
});

describe("invitations", () => {
  test("picks the newest ประกาศเชิญชวน with a file", () => {
    const reannounced: BmaAnnouncement = {
      ...ANNOUNCEMENTS[1]!,
      id: "later",
      projectAnnouncementPublishDate: "2026-10-05T17:00:00Z",
    };
    expect(latestInvitation(ANNOUNCEMENTS)?.id).toBe("3129864f-07ea-4389-81b2-37b540a3d4fe");
    expect(latestInvitation([...ANNOUNCEMENTS, reannounced])?.id).toBe("later");
    expect(latestInvitation([ANNOUNCEMENTS[0]!])).toBeNull();
  });

  test("the file URL percent-encodes the Thai filename", () => {
    expect(fileUrl(ANNOUNCEMENTS[1]!)).toBe(
      "https://egp2.bangkok.go.th/api/file/3129864f-07ea-4389-81b2-37b540a3d4fe/" +
        encodeURIComponent("ประกาศเชิญชวน_1790846137111.pdf"),
    );
  });
});

describe("discoverBma", () => {
  const row = (projectNumber: string, projectName: string): BmaListRow => ({
    projectId: `uuid-${projectNumber}`,
    projectNumber,
    projectName,
    masterOrgGroupName: null,
    masterOrgDepartmentName: null,
    projectBudget: null,
    masterContractAvailableCode: "S1",
  });

  test("details only title candidates, and stops once a page is mostly old", async () => {
    const pages: BmaPage<BmaListRow>[] = [
      {
        totalCount: 4,
        hasNextPage: true,
        data: [
          row("69099316505", DETAIL.projectName),
          row("69099442787", "ซื้อเครื่องวัดความยาวรากฟัน"),
          row("69099000001", "จ้างพัฒนาเว็บไซต์ (held)"),
        ],
      },
      {
        totalCount: 4,
        hasNextPage: true,
        data: [row("68019316505", "พัฒนาระบบสารสนเทศ"), row("68019442787", "ซื้อเก้าอี้")],
      },
      { totalCount: 4, hasNextPage: false, data: [row("69099999999", "พัฒนาระบบสารสนเทศ")] },
    ];
    const detailed: string[] = [];
    const api = {
      searchPage: async (n: number) => pages[n - 1]!,
      projectDetail: async (uuid: string) => {
        detailed.push(uuid);
        return { ...DETAIL, projectId: uuid, projectNumber: uuid.slice(5) };
      },
      announcements: async () => ANNOUNCEMENTS,
    };

    const out = [];
    const options = { lookbackDays: 150, maxPages: 10, now: new Date("2026-10-02"), isHeld: (n: string) => n === "69099000001" };
    for await (const raw of discoverBma(options, api)) {
      out.push(raw.projectId);
    }
    expect(out).toEqual(["69099316505", "68019316505"]);
    expect(detailed).toEqual(["uuid-69099316505", "uuid-68019316505"]);
  });

  test("the audit bar admits a title whose only term is ระบบ", () => {
    // Scores 8 ("ระบบ" alone): under the normal bar, inside the audit's.
    expect(isTitleCandidate("จ้างบำรุงรักษาระบบงานทะเบียน")).toBe(false);
    expect(isTitleCandidate("จ้างบำรุงรักษาระบบงานทะเบียน", 1)).toBe(true);
    expect(isTitleCandidate("จ้างเหมาทำความสะอาดในโรงเรียน", 1)).toBe(false);
  });

  test("isTitleCandidate is loose but not empty", () => {
    expect(isTitleCandidate("จ้างเหมาเอกชนดูแลเว็บไซต์ greener.bangkok.go.th")).toBe(true);
    expect(isTitleCandidate("จ้างเหมาทำความสะอาดในโรงเรียน")).toBe(false);
    // "ระบบ" alone is air conditioning as often as software.
    expect(isTitleCandidate("จ้างซ่อมแซมระบบปรับอากาศ")).toBe(false);
  });
});

describe("stageFromFlowName", () => {
  test("maps e-GP's step groups", () => {
    expect(stageFromFlowName("จัดทำ TOR")).toBe("tor");
    expect(stageFromFlowName("รายงานขอซื้อขอจ้าง")).toBe("purchaseReport");
    expect(stageFromFlowName("หนังสือเชิญชวน/ประกาศเชิญชวน")).toBe("invitation");
    expect(stageFromFlowName("อนุมัติสั่งซื้อสั่งจ้างและประกาศผู้ชนะการเสนอราคา")).toBe("awarded");
    expect(stageFromFlowName("จัดทำสัญญา/บริหารสัญญา")).toBe("contract");
    expect(stageFromFlowName("ยกเลิกโครงการ")).toBe("cancelled");
    expect(stageFromFlowName("something new")).toBeUndefined();
  });
});
