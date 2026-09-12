import type { RequestHandler } from "express";
import * as service from "./notification.service.ts";


export const listNotifications: RequestHandler = async (req, res) => {
  const query = req.query;
  res.json(await service.listNotifications(query));
};

export const getNotification: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getNotificationById(req.params.id));
};

export const createNotification: RequestHandler = async (req, res) => {
  const input = req.body;
  const created = await service.createNotification(input);

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateNotification: RequestHandler<{ id: string }> = async (req, res) => {
  const input = req.body;
  res.json(await service.updateNotification(req.params.id, input));
};

export const deleteNotification: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteNotification(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
