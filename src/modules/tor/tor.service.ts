import { isValidObjectId, type QueryFilter } from "mongoose";
import { ChunkModel } from "../extract/chunk.model.ts";
import { DocumentModel } from "../ingest/document.model.ts";
import { serialize, serializeDetail, serializeGrade } from "./tor.serialize.ts";
import { TOR_CATEGORIES, TorModel, type Tor, type TorLean } from "./tor.model.ts";

// Services return plain data (6). Every read that leaves this file has been
// through serialize() — the FR-19 gate — except getTorGrade, which is the
// deliberate, separately-routed exception.

export type ListInput = {
  q?: string;
  agency?: string;
  category?: (typeof TOR_CATEGORIES)[number];
  isSoftware?: boolean;
  province?: string;
  minBudget?: number;
  maxBudget?: number;
  page: number;
  limit: number;
};

export async function listTors(input: ListInput) {
  const filter: QueryFilter<Tor> = {};

  // Only publishable rows. A TOR still mid-pipeline is not a result.
  filter.status = { $in: ["graded", "published", "documents_fetched"] };

  if (input.agency) filter.agency = input.agency;
  if (input.category) filter.category = input.category;
  if (input.province) filter["location.province"] = input.province;
  if (typeof input.isSoftware === "boolean") filter.isSoftware = input.isSoftware;

  if (input.minBudget !== undefined || input.maxBudget !== undefined) {
    filter.budget = {};
    if (input.minBudget !== undefined) filter.budget.$gte = input.minBudget;
    if (input.maxBudget !== undefined) filter.budget.$lte = input.maxBudget;
  }

  if (input.q) {
    // Escaped: a user-supplied "(" must not become a regex the database chokes on.
    const safe = input.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.projectName = { $regex: safe, $options: "i" };
  }

  const skip = (input.page - 1) * input.limit;

  const [rows, total] = await Promise.all([
    TorModel.find(filter).sort({ announcedAt: -1 }).skip(skip).limit(input.limit).lean(),
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

/** The full grade. Kept off the public shape deliberately — mount behind auth. */
export async function getTorGrade(id: string) {
  if (!isValidObjectId(id)) return null;
  const tor = await TorModel.findById(id).lean();
  return tor ? serializeGrade(tor as TorLean) : null;
}

export async function listAgencies() {
  const rows = await TorModel.aggregate<{ _id: string; count: number }>([
    { $match: { agency: { $ne: null } } },
    { $group: { _id: "$agency", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 200 },
  ]);
  return rows.map((r) => ({ agency: r._id, count: r.count }));
}

export async function getStats() {
  const [total, software, byCategory, withSignals] = await Promise.all([
    TorModel.countDocuments(),
    TorModel.countDocuments({ isSoftware: true }),
    TorModel.aggregate<{ _id: string | null; n: number }>([
      { $group: { _id: "$category", n: { $sum: 1 } } },
      { $sort: { n: -1 } },
    ]),
    TorModel.countDocuments({ signalCount: { $gt: 0 } }),
  ]);

  return {
    total,
    software,
    // A count of documents carrying observations. Not a count of "suspicious"
    // tenders — that framing is the thing FR-19 forbids.
    withSignals,
    byCategory: byCategory.map((c) => ({ category: c._id, count: c.n })),
  };
}
