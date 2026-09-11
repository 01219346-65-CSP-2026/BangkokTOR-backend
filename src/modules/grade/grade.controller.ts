import type { Request, Response } from "express";
import { findUngraded, getGradeStatus, gradeTor } from "./grade.service.ts";

// 202-Accepted, like ingest and extract: grading takes minutes per TOR
// (measured ~206s), and the API never waits on pipeline work (NFR-01).
export async function startRun(req: Request, res: Response) {
  const raw = (req.body ?? {}) as { limit?: unknown };
  const limit =
    typeof raw.limit === "number" && Number.isFinite(raw.limit) && raw.limit > 0
      ? Math.floor(raw.limit)
      : 5;

  const pending = await findUngraded(limit);

  void (async () => {
    for (const tor of pending) {
      try {
        await gradeTor(tor._id);
      } catch (error) {
        console.error(`grade ${tor.projectId} threw:`, error);
      }
    }
  })();

  res.status(202).json({
    accepted: true,
    queued: pending.length,
    message: "grading started — poll GET /api/grade/status",
  });
}

export async function status(_req: Request, res: Response) {
  res.json(await getGradeStatus());
}
