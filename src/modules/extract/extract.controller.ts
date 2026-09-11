import type { Request, Response } from "express";
import { enqueuePending, getExtractStatus } from "./extract.service.ts";

// Same 202-Accepted shape as ingest: enqueueing may sweep thousands of rows,
// and the API never blocks on pipeline work (NFR-01).
export async function startRun(req: Request, res: Response) {
  const raw = (req.body ?? {}) as { limit?: unknown };
  const limit =
    typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
      ? Math.floor(raw.limit)
      : undefined;

  const result = await enqueuePending({ limit });

  res.status(202).json({
    accepted: true,
    ...result,
    message: "bundles enqueued — run `bun run extract-worker`, poll GET /api/extract/status",
  });
}

export async function status(_req: Request, res: Response) {
  res.json(await getExtractStatus());
}
