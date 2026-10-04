import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Types } from "mongoose";
import { env } from "../../config/env.ts";
import { pdfToText } from "../../lib/extract/fulltext.ts";
import { loadBundle } from "../../lib/extract/loader.ts";
import { unzipBundle } from "../../lib/extract/unzip.ts";
import { fetchDocument, listPublishedDocuments } from "../../lib/sources/ckan/documents.ts";
import { politeFetch } from "../../lib/http/politeClient.ts";
import { announcements, fileUrl, latestInvitation } from "../../lib/sources/bma/client.ts";
import { SOURCE_ID } from "../../lib/sources/ckan/normalize.ts";
import { procurementState, type BiddingStage } from "../../lib/sources/egp/procurement.ts";
import { parseBidDeadline, type BidDeadline } from "../../lib/thai/bidDeadline.ts";
import { ErrorModel } from "../ingest/error.model.ts";
import { TorModel } from "../tor/tor.model.ts";

// Is this TOR open for bids, and until when?
//
//   stage    — e-GP's live procurement step (lib/sources/egp/procurement.ts)
//   deadline — the bid date in the ประกาศเชิญชวน, parsed by
//              lib/thai/bidDeadline.ts. Read from, in order:
//                1. the newest invitation on the BMA portal (one small PDF)
//                2. annoudoc_* in e-GP's signed bundle, when (1) is missing
//                   or a scan. System-generated, so it always has text.
//
// A deadline that cannot be read is recorded in ingest_errors and left null
// (FR-06, FR-13). It is never estimated.

/** Stages that have, or are about to have, a published invitation. */
const HAS_INVITATION: BiddingStage[] = ["invitation", "awarded", "contract"];
/** Stages that can still change, so a daily refresh re-checks them. */
export const LIVE_STAGES: Array<BiddingStage | null> = [null, "tor", "purchaseReport", "invitation"];

const MAX_INVITATION_BYTES = 20_000_000;

export type BiddingTarget = {
  _id: Types.ObjectId;
  projectId: string;
  bmaProjectId?: string | null;
  trackBidding?: boolean | null;
  methodId?: string | null;
  bidClosesAt?: Date | null;
  deadlineEvidence?: { documentUrl?: string | null } | null;
};

export type BiddingResult = {
  stage: BiddingStage | null;
  closesAt: Date | null;
  note?: string;
};

async function recordError(projectId: string, kind: string, message: string, url?: string) {
  await ErrorModel.create({ sourceId: SOURCE_ID, projectId, kind, message: message.slice(0, 2000), url: url ?? null });
}

export async function checkBidding(tor: BiddingTarget): Promise<BiddingResult> {
  const state = await procurementState(tor.projectId);
  const $set: Record<string, unknown> = { stageCheckedAt: new Date() };

  if (!state) {
    await TorModel.updateOne({ _id: tor._id }, { $set });
    return { stage: null, closesAt: tor.bidClosesAt ?? null, note: "not-on-egp" };
  }

  $set.stageFlowName = state.flowName;
  if (state.stage) $set.biddingStage = state.stage;
  else if (state.flowName) await recordError(tor.projectId, "bidding-unknown-stage", `e-GP flowName "${state.flowName}"`);
  if (state.unknownProjectStatus) {
    await recordError(tor.projectId, "bidding-unknown-project-status", `e-GP projectStatus "${state.projectStatus}"`);
  }
  if (state.budgetYear) $set.fiscalYear = state.budgetYear;

  const stage = state.stage ?? null;
  let closesAt = tor.bidClosesAt ?? null;
  let note: string | undefined;

  // A direct award (เฉพาะเจาะจง) never publishes an invitation: there is no
  // deadline to read, and looking would only file a "not found" error per TOR.
  if ((tor.bmaProjectId || tor.trackBidding) && tor.methodId !== "specific" && stage && HAS_INVITATION.includes(stage)) {
    const read = await readDeadline(tor);
    note = read.note;
    if (read.set) {
      Object.assign($set, read.set);
      closesAt = read.set.bidClosesAt;
    }
  }

  await TorModel.updateOne({ _id: tor._id }, { $set });
  return { stage, closesAt, note };
}

type DeadlineRead = {
  note?: string;
  set?: {
    bidOpensAt: Date;
    bidClosesAt: Date;
    deadlineEvidence: { quote: string; documentUrl: string; publishedAt: Date | null };
  };
};

async function readDeadline(tor: BiddingTarget): Promise<DeadlineRead> {
  // Captured from e-GP (not on the BMA portal): the signed bundle is the only
  // source of the invitation.
  if (!tor.bmaProjectId) return signedOnlyDeadline(tor);

  const invitation = latestInvitation(await announcements(tor.bmaProjectId));
  const url = invitation ? fileUrl(invitation) : null;

  // Re-announcements publish a new invitation; the same one is not re-read.
  if (tor.bidClosesAt && url && tor.deadlineEvidence?.documentUrl === url) return { note: "unchanged" };

  const published = invitation?.projectAnnouncementPublishDate ? new Date(invitation.projectAnnouncementPublishDate) : null;
  const notes: string[] = [];

  if (url) {
    const text = await invitationText(tor.projectId, url);
    const deadline = text ? parseBidDeadline(text) : undefined;
    if (deadline) return found(deadline, url, published);
    notes.push(text === null ? "bma-unreadable" : text.trim() ? "bma-no-sentence" : "bma-scanned");
  } else {
    notes.push("bma-no-invitation");
  }

  // The e-GP signed bundle. Its annoudoc_* is generated by e-GP itself.
  const fallback = await signedBundleDeadline(tor.projectId);
  if (fallback.deadline) return found(fallback.deadline, fallback.url!, published);
  notes.push(fallback.note);

  if (tor.bidClosesAt) return { note: `kept-previous (${notes.join(", ")})` };
  await recordError(tor.projectId, "deadline-not-found", `no readable bid date: ${notes.join(", ")}`, url ?? fallback.url);
  return { note: notes.join(", ") };
}

async function signedOnlyDeadline(tor: BiddingTarget): Promise<DeadlineRead> {
  const read = await signedBundleDeadline(tor.projectId, tor.bidClosesAt ? tor.deadlineEvidence?.documentUrl : null);
  if (read.note === "unchanged") return { note: "unchanged" };
  if (read.deadline) return found(read.deadline, read.url!, null);
  if (tor.bidClosesAt) return { note: `kept-previous (${read.note})` };
  // No signed bundle yet is the normal state of a fresh invitation; only a
  // bundle that exists and still yields no date is worth an error row.
  if (read.note !== "egp-no-signed-bundle") {
    await recordError(tor.projectId, "deadline-not-found", `no readable bid date: ${read.note}`, read.url);
  }
  return { note: read.note };
}

function found(deadline: BidDeadline, url: string, publishedAt: Date | null): DeadlineRead {
  return {
    set: {
      bidOpensAt: deadline.opensAt,
      bidClosesAt: deadline.closesAt,
      deadlineEvidence: { quote: deadline.quote, documentUrl: url, publishedAt },
    },
  };
}

async function signedBundleDeadline(
  projectId: string,
  /** The bundle a deadline was already read from — not downloaded again. */
  knownUrl: string | null = null,
): Promise<{ deadline?: BidDeadline; url?: string; note: string }> {
  const [doc] = await listPublishedDocuments(projectId);
  if (!doc) return { note: "egp-no-signed-bundle" };
  if (knownUrl && doc.url === knownUrl) return { url: doc.url, note: "unchanged" };

  const dir = join(env.blobDir, "bidding", `${projectId}-signed`);
  await mkdir(dir, { recursive: true });
  try {
    const fetched = await fetchDocument(doc, join(dir, "bundle.zip"));
    if (!fetched.ok) return { url: doc.url, note: `egp-${fetched.reason}` };

    const unzipped = await unzipBundle(fetched.path, join(dir, "pdf"));
    if (!unzipped.ok) return { url: doc.url, note: `egp-unzip-${unzipped.reason}` };

    const announcement = unzipped.files.filter((f) => f.name.toLowerCase().startsWith("annoudoc_"));
    if (announcement.length === 0) return { url: doc.url, note: "egp-no-annoudoc" };

    const loaded = await loadBundle(announcement, join(dir, "json"), 120_000);
    if (!loaded.ok) return { url: doc.url, note: "egp-loader-failed" };

    const deadline = parseBidDeadline(loaded.pdfs.map(pdfToText).join("\n"));
    return deadline ? { deadline, url: doc.url, note: "egp" } : { url: doc.url, note: "egp-no-sentence" };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Download one invitation PDF and read its text. Null (recorded) on failure. */
async function invitationText(projectId: string, url: string): Promise<string | null> {
  const dir = join(env.blobDir, "bidding", projectId);
  const path = join(dir, "invitation.pdf");
  await mkdir(dir, { recursive: true });

  try {
    const response = await politeFetch(url);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A 200 HTML error page is a real failure mode on these hosts.
    if (bytes.byteLength > MAX_INVITATION_BYTES || new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") {
      await recordError(projectId, "invitation-not-a-pdf", `${bytes.byteLength} bytes, not a PDF`, url);
      return null;
    }
    await Bun.write(path, bytes);

    const loaded = await loadBundle([{ path, name: "invitation.pdf", bytes: bytes.byteLength }], dir, 120_000);
    if (!loaded.ok) {
      await recordError(projectId, "invitation-loader-failed", loaded.message, url);
      return null;
    }
    return loaded.pdfs.map(pdfToText).join("\n");
  } catch (error) {
    await recordError(projectId, "invitation-fetch-failed", String(error), url);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Re-check every tracked TOR (BMA or captured) whose stage can still move (NFR-02). Stages advance
 * and re-announcements move dates, so a once-read deadline is not final.
 */
export async function refreshBidding(options: { limit?: number; log?: (line: string) => void } = {}) {
  const rows = await TorModel.find(
    { $or: [{ bmaProjectId: { $ne: null } }, { trackBidding: true }], biddingStage: { $in: LIVE_STAGES } },
    { projectId: 1, bmaProjectId: 1, trackBidding: 1, methodId: 1, bidClosesAt: 1, deadlineEvidence: 1 },
  )
    .limit(options.limit ?? 0)
    .lean();

  const counts = { checked: 0, open: 0, failed: 0 };
  for (const row of rows) {
    try {
      const result = await checkBidding(row as BiddingTarget);
      counts.checked++;
      if (result.stage === "invitation" && result.closesAt && result.closesAt > new Date()) counts.open++;
      options.log?.(`${row.projectId} ${result.stage ?? "?"} ${result.closesAt?.toISOString() ?? "-"} ${result.note ?? ""}`);
    } catch (error) {
      counts.failed++;
      await recordError(row.projectId, "bidding-check-failed", String(error));
    }
  }
  return { candidates: rows.length, ...counts };
}
