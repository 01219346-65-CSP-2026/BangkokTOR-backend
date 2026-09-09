import { Router } from "express";
import * as controller from "./notification.controller.ts";


export const notificationRouter = Router();

notificationRouter.get("/", controller.listNotifications);
notificationRouter.post("/", controller.createNotification);

notificationRouter.get("/:id", controller.getNotification);
notificationRouter.patch("/:id", controller.updateNotification);
notificationRouter.delete("/:id", controller.deleteNotification);