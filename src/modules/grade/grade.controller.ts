import type { Request, Response } from "express";
import { HttpError } from "../../middleware/errors.ts";
import { findUngraded, getGradeStatus, gradeTor, listPendingReviews, resolveReview } from "./grade.service.ts";

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

/** T16: absence findings waiting for a human, oldest first. */
export async function listReviews(req: Request, res: Response) {
  res.json({ items: await listPendingReviews(Number(req.query.limit ?? 50)) });
}

/** T16: confirm or reject one held finding; the grade is re-scored. */
export async function resolve(req: Request, res: Response) {
  const decision = (req.body ?? {}).decision;
  if (decision !== "confirm" && decision !== "reject") {
    throw new HttpError(400, 'Expected { decision: "confirm" | "reject" }.');
  }
  const outcome = await resolveReview(String(req.params.torId), String(req.params.code), decision);
  if (!outcome.ok) {
    throw new HttpError(
      outcome.reason === "not-found" ? 404 : 409,
      outcome.reason === "not-found" ? "TOR not found" : "No finding with that code is awaiting review",
    );
  }
  res.json(outcome);
}
