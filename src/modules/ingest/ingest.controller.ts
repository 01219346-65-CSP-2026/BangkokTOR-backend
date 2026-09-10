import type { Request, Response } from "express";
import { getStatus, runDiscovery } from "./ingest.service.ts";
import { parseRunInput } from "./ingest.validation.ts";

// Discovery is long — 16 pages, and enqueueing up to 511k rows. It is kicked off
// and the request returns immediately (NFR-01: the API never waits on ingestion).
export async function startRun(req: Request, res: Response) {
  const input = parseRunInput(req.body);

  void runDiscovery(input).catch((error) => {
    // The run row already records the failure; this keeps the rejection from
    // surfacing as an unhandled promise and killing the process.
    console.error("discovery failed:", error);
  });

  res.status(202).json({
    accepted: true,
    limit: input.limit ?? null,
    resume: input.resume,
    message: "discovery started — poll GET /api/ingest/status",
  });
}

export async function status(_req: Request, res: Response) {
  res.json(await getStatus());
}
