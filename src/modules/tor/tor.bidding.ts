import type { BiddingStage } from "../../lib/sources/egp/procurement.ts";

// Open, upcoming or closed: what the website sorts and filters by. One
// definition, in two forms — a function for the serializer and Mongo filters
// for the list — that must agree. tor.bidding.test.ts checks they do.
//
//   open     — the ประกาศเชิญชวน is out and the bid deadline has not passed
//              (or could not be read yet: the stage says bids are being taken)
//   upcoming — still at TOR or purchase-report stage; no invitation yet
//   closed   — everything else: past the deadline, awarded, contracted,
//              cancelled, never checked (the national awarded history), and
//              every direct award (เฉพาะเจาะจง): it never publishes an
//              invitation, so nobody outside can bid on it at any stage

export const BIDDING_STATUSES = ["open", "upcoming", "closed"] as const;
export type BiddingStatus = (typeof BIDDING_STATUSES)[number];

/** The website's default view: what a team can still act on. */
export const DEFAULT_BIDDING: BiddingStatus[] = ["open", "upcoming"];

const UPCOMING_STAGES: BiddingStage[] = ["tor", "purchaseReport"];

/** A direct award: kept as TOR data, never biddable. */
const DIRECT_AWARD = "specific";

export function biddingStatus(
  tor: { biddingStage?: string | null; bidClosesAt?: Date | null; methodId?: string | null },
  now: Date = new Date(),
): BiddingStatus {
  if (tor.methodId === DIRECT_AWARD) return "closed";
  if (tor.biddingStage === "invitation" && (!tor.bidClosesAt || tor.bidClosesAt > now)) return "open";
  if (tor.biddingStage && (UPCOMING_STAGES as string[]).includes(tor.biddingStage)) return "upcoming";
  return "closed";
}

export function biddingFilter(status: BiddingStatus, now: Date = new Date()): Record<string, unknown> {
  const biddable = { methodId: { $ne: DIRECT_AWARD } };
  const open = { ...biddable, biddingStage: "invitation", $or: [{ bidClosesAt: { $gt: now } }, { bidClosesAt: null }] };
  const upcoming = { ...biddable, biddingStage: { $in: UPCOMING_STAGES } };
  if (status === "open") return open;
  if (status === "upcoming") return upcoming;
  return { $nor: [open, upcoming] };
}

/** Several statuses → one filter. All three (or none) → no restriction. */
export function biddingFilterFor(statuses: BiddingStatus[], now: Date = new Date()): Record<string, unknown> | null {
  const unique = [...new Set(statuses)];
  if (unique.length === 0 || unique.length === BIDDING_STATUSES.length) return null;
  return unique.length === 1 ? biddingFilter(unique[0]!, now) : { $or: unique.map((s) => biddingFilter(s, now)) };
}

/*
 * The procurement stage — the สถานะโครงการ filter. e-GP's own step
 * (biddingStage) where it has been read. The national awarded history was never
 * stage-checked, but its rows carry the evidence: a signed contract date means
 * the contract stage, and the portal's "ยกเลิกโครงการ" means cancelled.
 *
 * Replaced the portal's contract-level สถานะโครงการ, which read
 * "ระหว่างดำเนินการ" for open tenders and finished contracts alike.
 */
const CANCELLED_STATUS = "ยกเลิกโครงการ";

export function stageFilter(stage: BiddingStage): Record<string, unknown> {
  if (stage === "contract") {
    return {
      $or: [
        { biddingStage: "contract" },
        { biddingStage: null, projectStatus: { $ne: CANCELLED_STATUS }, contractSignedAt: { $ne: null } },
      ],
    };
  }
  if (stage === "cancelled") {
    return { $or: [{ biddingStage: "cancelled" }, { biddingStage: null, projectStatus: CANCELLED_STATUS }] };
  }
  return { biddingStage: stage };
}

/** The same rule for one row, for the serializer. Null when nothing says. */
export function procurementStage(tor: {
  biddingStage?: string | null;
  projectStatus?: string | null;
  contractSignedAt?: Date | null;
}): BiddingStage | null {
  if (tor.biddingStage) return tor.biddingStage as BiddingStage;
  if (tor.projectStatus === CANCELLED_STATUS) return "cancelled";
  return tor.contractSignedAt ? "contract" : null;
}

/** The same rule as an aggregation expression, for the facet counts. */
export const STAGE_EXPRESSION = {
  $ifNull: [
    "$biddingStage",
    {
      $cond: [
        { $eq: ["$projectStatus", CANCELLED_STATUS] },
        "cancelled",
        { $cond: [{ $ne: [{ $ifNull: ["$contractSignedAt", null] }, null] }, "contract", null] },
      ],
    },
  ],
};

const FAR_FUTURE = new Date("9999-12-31T00:00:00Z");

/**
 * Aggregation stages for the `closingSoon` order: open first (soonest deadline
 * first, unknown deadlines after known ones), then upcoming, then closed (most
 * recent deadline first). Same status rule as above, expressed in $expr.
 */
export function closingSoonStages(now: Date = new Date()) {
  const biddable = { $ne: [{ $ifNull: ["$methodId", null] }, DIRECT_AWARD] };
  const isOpen = {
    $and: [
      biddable,
      { $eq: ["$biddingStage", "invitation"] },
      { $or: [{ $eq: [{ $ifNull: ["$bidClosesAt", null] }, null] }, { $gt: ["$bidClosesAt", now] }] },
    ],
  };
  const isUpcoming = { $and: [biddable, { $in: [{ $ifNull: ["$biddingStage", null] }, UPCOMING_STAGES] }] };
  return [
    {
      $addFields: {
        _biddingRank: { $switch: { branches: [{ case: isOpen, then: 0 }, { case: isUpcoming, then: 1 }], default: 2 } },
        _closesAsc: { $ifNull: ["$bidClosesAt", FAR_FUTURE] },
        // Closed rows: the latest deadline first, and the never-checked last.
        _closesDesc: { $ifNull: ["$bidClosesAt", new Date(0)] },
      },
    },
    {
      $addFields: {
        _closesKey: {
          $cond: [{ $eq: ["$_biddingRank", 2] }, { $subtract: [0, { $toLong: "$_closesDesc" }] }, { $toLong: "$_closesAsc" }],
        },
      },
    },
  ];
}

export const CLOSING_SOON_SORT = { _biddingRank: 1, _closesKey: 1, announcedAt: -1, _id: -1 } as const;
export const CLOSING_SOON_FIELDS = ["_biddingRank", "_closesAsc", "_closesDesc", "_closesKey"];
