import type { RequestHandler } from "express";
import * as service from "./example.service.ts";
import { parseCreateInput, parseListQuery, parseUpdateInput } from "./example.validation.ts";

/**
 * The CONTROLLER layer is deliberately boring. Its whole job is HTTP:
 *
 *   1. pull input off the request and validate it
 *   2. call one service function
 *   3. pick a status code and send the result
 *
 * No queries, no business rules, no try/catch. Express 5 forwards a rejected
 * async handler to the error middleware on its own, so a thrown HttpError
 * becomes the right response without any plumbing here.
 *
 * If a handler grows past ~10 lines, the extra logic belongs in the service.
 */

export const listExamples: RequestHandler = async (req, res) => {
  const query = parseListQuery(req.query);
  res.json(await service.listExamples(query));
};

export const getExample: RequestHandler<{ id: string }> = async (req, res) => {
  res.json(await service.getExampleById(req.params.id));
};

export const createExample: RequestHandler = async (req, res) => {
  const input = parseCreateInput(req.body);
  const created = await service.createExample(input);

  // 201 + Location is what a well-behaved REST API returns for a create.
  res.status(201).location(`${req.baseUrl}/${created.id}`).json(created);
};

export const updateExample: RequestHandler<{ id: string }> = async (req, res) => {
  const input = parseUpdateInput(req.body);
  res.json(await service.updateExample(req.params.id, input));
};

export const deleteExample: RequestHandler<{ id: string }> = async (req, res) => {
  await service.deleteExample(req.params.id);

  // 204 means "done, nothing to send" — so send no body.
  res.status(204).end();
};
