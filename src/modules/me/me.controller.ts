import type { RequestHandler } from "express";
import * as service from "./me.service.ts";
import { parseProfilePut } from "./me.validation.ts";

// `res.locals.userId` is set by requireUser, which every route in this module
// sits behind. Nothing here takes a user id from the request itself.

export const getProfile: RequestHandler = async (_req, res) => {
  const profile = await service.getProfile(res.locals.userId as string);

  // 204: signed in, but never saved a profile. The wizard starts at step 1.
  if (!profile) {
    res.status(204).end();
    return;
  }
  res.json(profile);
};

export const putProfile: RequestHandler = async (req, res) => {
  res.json(await service.putProfile(res.locals.userId as string, parseProfilePut(req.body)));
};
