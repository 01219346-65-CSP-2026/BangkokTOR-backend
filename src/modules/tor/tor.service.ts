import { resolve, sep } from "node:path";
import { isValidObjectId, type QueryFilter } from "mongoose";
import { env } from "../../config/env.ts";
import { ChunkModel } from "../extract/chunk.model.ts";
import { DocumentModel } from "../ingest/document.model.ts";
import { serialize, serializeDetail, serializeGrade } from "./tor.serialize.ts";
import {
  TOR_CATEGORIES,
  TOR_METHODS,
  TOR_SORTS,
  TorModel,
  type Tor,
  type TorLean,
  type TorStatus,
} from "./tor.model.ts";

// Services return plain data (6). Every read that leaves this file has been
// through serialize() — the FR-19 gate — except getTorGrade, which is the
// deliberate, separately-routed exception.

export type ListInput = {
  q?: string;
  agency?: string;
  category?: (typeof TOR_CATEGORIES)[number];
  method?: (typeof TOR_METHODS)[number];
  isSoftware?: boolean;
  province?: string;
  minBudget?: number;
  maxBudget?: number;
  publishedFrom?: Date;
  publishedTo?: Date;
  sort?: (typeof TOR_SORTS)[number];
  page: number;
  limit: number;
};

/** `newest` is the historical default (announcedAt desc) — every existing
 *  caller that omits `sort` must keep seeing that order. */
const SORTS: Record<(typeof TOR_SORTS)[number], Record<string, 1 | -1>> = {
  newest: { announcedAt: -1 },
  oldest: { announcedAt: 1 },
  budgetHigh: { budget: -1 },
  budgetLow: { budget: 1 },
};

/** The statuses the public list shows — see the note in listTors. Agency
 *  and category counts use the same set, so a count always matches what
 *  choosing that option returns. */
const LISTED = { $in: ["graded", "published", "documents_fetched"] as TorStatus[] };

export async function listTors(input: ListInput) {
  const filter: QueryFilter<Tor> = {};

  /*
   * What counts as a result.
   *
   * The comment here used to claim "only publishable rows", which was not what
   * the code did: `documents_fetched` means the zip was downloaded and nothing
   * more — not extracted, not graded, no summary. Those rows are in the list
   * deliberately (FR-12: a record with a budget, an agency and a link back to
   * source is useful on its own, and excluding them would empty the listings
   * while the pipeline catches up), but calling that "publishable" hid the
   * trade.
   *
   * `published` stays in the $in for the day an editorial promotion step
   * exists. Nothing writes it today — see TOR_STATUSES in tor.model.ts.
   */
  filter.status = LISTED;

  if (input.agency) filter.agency = input.agency;
  if (input.category) filter.category = input.category;
  if (input.method) filter.methodId = input.method;
  if (input.province) filter["location.province"] = input.province;
  if (typeof input.isSoftware === "boolean") filter.isSoftware = input.isSoftware;

  if (input.minBudget !== undefined || input.maxBudget !== undefined) {
    filter.budget = {};
    if (input.minBudget !== undefined) filter.budget.$gte = input.minBudget;
    if (input.maxBudget !== undefined) filter.budget.$lte = input.maxBudget;
  }

  if (input.publishedFrom !== undefined || input.publishedTo !== undefined) {
    filter.announcedAt = {};
    if (input.publishedFrom !== undefined) filter.announcedAt.$gte = input.publishedFrom;
    if (input.publishedTo !== undefined) filter.announcedAt.$lte = input.publishedTo;
  }

  if (input.q) {
    // Escaped: a user-supplied "(" must not become a regex the database chokes on.
    const safe = input.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.projectName = { $regex: safe, $options: "i" };
  }

  const skip = (input.page - 1) * input.limit;
  const sort = SORTS[input.sort ?? "newest"];

  const [rows, total] = await Promise.all([
    TorModel.find(filter).sort(sort).skip(skip).limit(input.limit).lean(),
    TorModel.countDocuments(filter),
  ]);

  return {
    items: rows.map((r) => serialize(r as TorLean)),
    page: input.page,
    limit: input.limit,
    total,
    pages: Math.ceil(total / input.limit),
  };
}

export async function getTor(id: string) {
  if (!isValidObjectId(id)) return null;
  const tor = await TorModel.findById(id).lean();
  return tor ? serialize(tor as TorLean) : null;
}

export async function getTorDetail(id: string) {
  if (!isValidObjectId(id)) return null;

  const tor = await TorModel.findById(id).lean();
  if (!tor) return null;

  const [documents, chunks] = await Promise.all([
    DocumentModel.find({ torId: tor._id }).sort({ createdAt: 1 }).lean(),
    ChunkModel.find({ torId: tor._id }).sort({ index: 1 }).lean(),
  ]);

  return serializeDetail(tor as TorLean, documents, chunks);
}

/**
 * An expanded PDF from a TOR's bundle, ready to stream. Null for anything a
 * guest should not be able to reach: a document belonging to another TOR, a
 * row that is not an `extractedPdf`, or a path that has left the extract
 * directory or no longer exists on disk.
 */
export async function getDocumentFile(torId: string, documentId: string) {
  if (!isValidObjectId(torId) || !isValidObjectId(documentId)) return null;

  const document = await DocumentModel.findOne({
    _id: documentId,
    torId,
    kind: "extractedPdf",
  }).lean();
  if (!document?.localPath) return null;

  const root = resolve(env.extractDir) + sep;
  const path = resolve(document.localPath);
  if (!path.startsWith(root)) return null;
  if (!(await Bun.file(path).exists())) return null;

  return { path, filename: document.filename ?? "document.pdf" };
}

/** The full grade. Kept off the public shape deliberately — mount behind auth. */
export async function getTorGrade(id: string) {
  if (!isValidObjectId(id)) return null;
  const tor = await TorModel.findById(id).lean();
  return tor ? serializeGrade(tor as TorLean) : null;
}

export async function listAgencies() {
  const rows = await TorModel.aggregate<{ _id: string; count: number }>([
    { $match: { status: LISTED, agency: { $nin: [null, ""] } } },
    { $group: { _id: "$agency", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);
  return rows.map((r) => ({ agency: r._id, count: r.count }));
}

export async function getStats() {
  const [total, software, byCategory, byMethod, withSignals, top] = await Promise.all([
    TorModel.countDocuments(),
    TorModel.countDocuments({ isSoftware: true }),
    TorModel.aggregate<{ _id: string | null; n: number }>([
      { $match: { status: LISTED } },
      { $group: { _id: "$category", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    TorModel.aggregate<{ _id: string | null; n: number }>([
      { $match: { status: LISTED } },
      { $group: { _id: "$methodId", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    TorModel.countDocuments({ signalCount: { $gt: 0 } }),
    TorModel.findOne({ status: LISTED, budget: { $ne: null } }, { budget: 1 })
      .sort({ budget: -1 })
      .lean(),
  ]);

  return {
    total,
    software,
    // A count of documents carrying observations. Not a count of "suspicious"
    // tenders — that framing is the thing FR-19 forbids.
    withSignals,
    // Both are over the listed rows only, so they are the filter rail's
    // option counts as well.
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.n })),
    byMethod: byMethod.map((m) => ({ method: m._id, count: m.n })),
    // The budget slider's right edge.
    maxBudget: top?.budget ?? null,
  };
}
