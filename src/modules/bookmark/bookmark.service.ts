import { HttpError } from "../../middleware/errors.ts";
import { assertValidId } from "../../shared/utils/assertValidId.ts";
import { serialize, type PublicTor } from "../tor/tor.serialize.ts";
import { TorModel, type TorLean } from "../tor/tor.model.ts";
import { BookmarkModel } from "./bookmark.model.ts";

// Every function takes the user id from requireUser — never from the request.

export type BookmarkedTor = PublicTor & { bookmarkedAt: string };

/**
 * The reader's saved TORs, newest first, through serialize() — the FR-19 gate
 * applies here like on any public read. Deliberately NOT narrowed to the
 * public scope: a TOR someone saved stays on their list even after the
 * listings move on to a new fiscal year. A TOR that no longer exists at all
 * simply drops out.
 */
export async function listBookmarks(userId: string): Promise<BookmarkedTor[]> {
  const rows = await BookmarkModel.find({ userId }).sort({ createdAt: -1 }).lean();
  if (rows.length === 0) return [];

  const tors = await TorModel.find({ _id: { $in: rows.map((r) => r.torId) } }).lean();
  const byId = new Map(tors.map((t) => [String(t._id), t as TorLean]));

  return rows.flatMap((row) => {
    const tor = byId.get(String(row.torId));
    return tor ? [{ ...serialize(tor), bookmarkedAt: row.createdAt.toISOString() }] : [];
  });
}

export async function isBookmarked(userId: string, torId: string): Promise<boolean> {
  assertValidId(torId);
  return (await BookmarkModel.exists({ userId, torId })) !== null;
}

/** Idempotent: saving an already-saved TOR is a no-op, not an error. */
export async function addBookmark(userId: string, torId: string): Promise<void> {
  assertValidId(torId);
  if (!(await TorModel.exists({ _id: torId }))) throw new HttpError(404, `TOR not found: ${torId}`);

  await BookmarkModel.updateOne({ userId, torId }, { $setOnInsert: { userId, torId } }, { upsert: true });
}

/** Idempotent: removing one that isn't saved is a no-op. */
export async function removeBookmark(userId: string, torId: string): Promise<void> {
  assertValidId(torId);
  await BookmarkModel.deleteOne({ userId, torId });
}
