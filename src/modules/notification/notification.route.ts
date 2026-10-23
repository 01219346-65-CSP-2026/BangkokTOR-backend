import { Router } from "express";
import * as controller from "./notification.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";

export const notificationRouter = Router();

// Admin only, reads included: GET /?user_id= handed anyone's notifications to
// anyone (IDOR, NFR-08). Readers use /api/me/notifications instead.
notificationRouter.get("/", requireAdminToken, controller.listNotifications);
notificationRouter.post("/", requireAdminToken, controller.createNotification);

notificationRouter.get("/:id", requireAdminToken, controller.getNotification);
notificationRouter.patch("/:id", requireAdminToken, controller.updateNotification);
notificationRouter.delete("/:id", requireAdminToken, controller.deleteNotification);
