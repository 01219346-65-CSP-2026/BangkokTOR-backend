import { Router } from "express";
import * as controller from "./notification.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";

export const notificationRouter = Router();

// Reads stay open; anything that mutates the collection needs the shared
// secret. Before this, an anonymous caller could create or delete rows.
notificationRouter.get("/", controller.listNotifications);
notificationRouter.post("/", requireAdminToken, controller.createNotification);

notificationRouter.get("/:id", controller.getNotification);
notificationRouter.patch("/:id", requireAdminToken, controller.updateNotification);
notificationRouter.delete("/:id", requireAdminToken, controller.deleteNotification);
