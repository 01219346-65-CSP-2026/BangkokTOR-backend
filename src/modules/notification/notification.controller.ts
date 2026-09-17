import type { RequestHandler } from "express";
import * as service from "./notification.service.ts";
import {
  parseCreateNotification,
  parseListNotifications,
  parseUpdateNotification,
} from "./notification.validation.ts";

// Controllers stay thin: parse, delegate, respond. The parse step is what lets
// the service assume its input is already the right shape.

export const listNotifications: RequestHandler = async (req, res) => {
  res.json(await service.listNotifications(parseListNotifications(req.query)));
};

export const getNotification: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getNotificationById(req.params.id));
};

export const createNotification: RequestHandler = async (req, res) => {
  const created = await service.createNotification(parseCreateNotification(req.body));

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateNotification: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(
    await service.updateNotification(req.params.id, parseUpdateNotification(req.body)),
  );
};

export const deleteNotification: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteNotification(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
