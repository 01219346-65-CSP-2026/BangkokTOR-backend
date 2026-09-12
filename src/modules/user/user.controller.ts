import type { RequestHandler } from "express";
import * as service from "./user.service.ts";
import {
  parseCreateUser,
  parseListUsers,
  parseUpdateUser,
} from "./user.validation.ts";

// Controllers stay thin: parse, delegate, respond. The parse step is what lets
// the service assume its input is already the right shape — and for users it is
// also the security boundary, since it is what keeps `role` out of an update.

export const listUsers: RequestHandler = async (req, res) => {
  res.json(await service.listUsers(parseListUsers(req.query)));
};

export const getUser: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getUserById(req.params.id));
};

export const createUser: RequestHandler = async (req, res) => {
  const created = await service.createUser(parseCreateUser(req.body));

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateUser: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.updateUser(req.params.id, parseUpdateUser(req.body)));
};

export const deleteUser: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteUser(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
