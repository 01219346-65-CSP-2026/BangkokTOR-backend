import type { RequestHandler } from "express";
import * as service from "./user.service.ts";


export const listUsers: RequestHandler = async (req, res) => {
  const query = req.query;
  res.json(await service.listUsers(query));
};

export const getUser: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getUserById(req.params.id));
};

export const createUser: RequestHandler = async (req, res) => {
  const input = req.body;
  const created = await service.createUser(input);

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateUser: RequestHandler<{ id: string }> = async (req, res) => {
  const input = req.body;
  res.json(await service.updateUser(req.params.id, input));
};

export const deleteUser: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteUser(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
