import type { RequestHandler } from "express";
import { HttpError } from "../../middleware/errors.ts";
import { getPipelineStatus, isQueueStage, listQueueRows, listRuns } from "./monitor.service.ts";

// Read-only operational views. Express 5 forwards a rejected promise to the
// error handler on its own, so these don't need try/catch.

export const status: RequestHandler = async (_req, res) => {
  res.json(await getPipelineStatus());
};

export const queue: RequestHandler = async (req, res) => {
  const stage = String(req.query.stage ?? "ingest");
  if (!isQueueStage(stage)) {
    // Grading has no queue collection, so asking for it is a real mistake
    // rather than an empty result — say so.
    throw new HttpError(400, `Unknown stage: ${stage}. Expected "ingest" or "extract".`);
  }

  const statusFilter = req.query.status ? String(req.query.status) : undefined;

  res.json(
    await listQueueRows({
      stage,
      status: statusFilter,
      page: Number(req.query.page ?? 1) || 1,
      limit: Number(req.query.limit ?? 25) || 25,
    }),
  );
};

export const runs: RequestHandler = async (req, res) => {
  res.json({ items: await listRuns(Number(req.query.limit ?? 20) || 20) });
};
