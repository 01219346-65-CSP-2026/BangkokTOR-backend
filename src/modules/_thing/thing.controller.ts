import type { RequestHandler } from "express";
import * as service from "./thing.service.ts";


export const listThings: RequestHandler = async (req, res) => {
  const query = req.query;
  res.json(await service.listThings(query));
};

export const getThing: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getThingById(req.params.id));
};

export const createThing: RequestHandler = async (req, res) => {
  const input = req.body;
  const created = await service.createThing(input);

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateThing: RequestHandler<{ id: string }> = async (req, res) => {
  const input = req.body;
  res.json(await service.updateThing(req.params.id, input));
};

export const deleteThing: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteThing(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
