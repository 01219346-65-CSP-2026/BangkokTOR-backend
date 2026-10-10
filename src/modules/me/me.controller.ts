import type { RequestHandler } from "express";
import * as service from "./me.service.ts";
import * as bookmarks from "../bookmark/bookmark.service.ts";
import { parseProfilePut } from "./me.validation.ts";

// `res.locals.userId` is set by requireUser, which every route in this module
// sits behind. Nothing here takes a user id from the request itself.

export const getProfile: RequestHandler = async (_req, res) => {
  const profile = await service.getProfile(res.locals.userId as string);

  // 204: signed in, but never saved a profile. The wizard starts at step 1.
  if (!profile) {
    res.status(204).end();
    return;
  }
  res.json(profile);
};

export const putProfile: RequestHandler = async (req, res) => {
  res.json(await service.putProfile(res.locals.userId as string, parseProfilePut(req.body)));
};

const userIdOf = (res: Parameters<RequestHandler>[1]) => res.locals.userId as string;
const torIdOf = (req: Parameters<RequestHandler>[0]) => String(req.params.torId);

export const listBookmarks: RequestHandler = async (_req, res) => {
  res.json({ items: await bookmarks.listBookmarks(userIdOf(res)) });
};

export const getBookmark: RequestHandler = async (req, res) => {
  res.json({ bookmarked: await bookmarks.isBookmarked(userIdOf(res), torIdOf(req)) });
};

// PUT/DELETE rather than POST: both are idempotent, so a double click or a
// retried request can never create a second bookmark or fail on a missing one.
export const putBookmark: RequestHandler = async (req, res) => {
  await bookmarks.addBookmark(userIdOf(res), torIdOf(req));
  res.status(204).end();
};

export const deleteBookmark: RequestHandler = async (req, res) => {
  await bookmarks.removeBookmark(userIdOf(res), torIdOf(req));
  res.status(204).end();
};
