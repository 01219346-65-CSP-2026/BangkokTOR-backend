import type { RequestHandler } from "express";
import { HttpError } from "../../middleware/errors.ts";
import {
  flushDeadWorkers,
  getPipelineStatus,
  isQueueStage,
  listQueueRows,
  listRuns,
  requestStop,
  retryError,
} from "./monitor.service.ts";

// Operational views, plus the three admin-token controls at the bottom. Express 5 forwards a rejected promise to the
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

export const stopWorkers: RequestHandler = async (req, res) => {
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || !ids.every((i) => typeof i === "string")) {
    throw new HttpError(400, "Expected { ids: string[] } with 1-100 worker ids.");
  }
  res.json(await requestStop(ids));
};

export const flushWorkers: RequestHandler = async (_req, res) => {
  res.json(await flushDeadWorkers());
};

export const retry: RequestHandler = async (req, res) => {
  res.json(await retryError(String(req.params.id)));
};
