import { Router } from "express";
import * as controller from "./me.controller.ts";
import { requireUser } from "../../middleware/requireUser.ts";
import { meLimit, profileLimit } from "../../middleware/limits.ts";

/**
 * The signed-in user's own data. No `:id` anywhere: who the data belongs to
 * comes from the verified token, never from the URL or body (NFR-08).
 */
export const meRouter = Router();

// requireUser only at the router level — rate limits are set per route below,
// the same reason ingest/extract/grade do it: GET / is polled far more often
// than the rest (see limits.ts meLimit) and must not share their budget.
meRouter.use(requireUser);

// Polled by the frontend's NextAuth `jwt` callback on every request, to
// re-validate role and session_version instead of trusting the session
// cookie's cached copy (T03/T05, NFR-10). Deliberately the bare minimum.
meRouter.get("/", meLimit, controller.getMe);

meRouter.get("/profile", profileLimit, controller.getProfile);
meRouter.put("/profile", profileLimit, controller.putProfile);

meRouter.get("/bookmarks", profileLimit, controller.listBookmarks);
meRouter.get("/bookmarks/:torId", profileLimit, controller.getBookmark);
meRouter.put("/bookmarks/:torId", profileLimit, controller.putBookmark);
meRouter.delete("/bookmarks/:torId", profileLimit, controller.deleteBookmark);

meRouter.get("/notifications", profileLimit, controller.listNotifications);
meRouter.patch("/notifications/:id/read", profileLimit, controller.markNotificationRead);
