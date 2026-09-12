import type { RequestHandler } from "express";
import * as service from "./techstack.service.ts";


export const listTechstacks: RequestHandler = async (req, res) => {
  const query = req.query;
  res.json(await service.listTechstacks(query));
};

export const getTechstack: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getTechstackById(req.params.id));
};

export const createTechstack: RequestHandler = async (req, res) => {
  const input = req.body;
  const created = await service.createTechstack(input);

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateTechstack: RequestHandler<{ id: string }> = async (req, res) => {
  const input = req.body;
  res.json(await service.updateTechstack(req.params.id, input));
};

export const deleteTechstack: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteTechstack(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
