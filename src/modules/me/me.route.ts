import { Router } from "express";
import * as controller from "./me.controller.ts";
import { requireUser } from "../../middleware/requireUser.ts";
import { profileLimit } from "../../middleware/limits.ts";

/**
 * The signed-in user's own data. No `:id` anywhere: who the data belongs to
 * comes from the verified token, never from the URL or body (NFR-08).
 */
export const meRouter = Router();

// requireUser first — profileLimit keys its bucket by the user it resolves.
meRouter.use(requireUser, profileLimit);

meRouter.get("/profile", controller.getProfile);
meRouter.put("/profile", controller.putProfile);

meRouter.get("/bookmarks", controller.listBookmarks);
meRouter.get("/bookmarks/:torId", controller.getBookmark);
meRouter.put("/bookmarks/:torId", controller.putBookmark);
meRouter.delete("/bookmarks/:torId", controller.deleteBookmark);
