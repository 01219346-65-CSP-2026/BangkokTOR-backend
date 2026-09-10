import { hostname } from "node:os";
import { HeartbeatModel, type WorkerKind, type WorkerState } from "./heartbeat.model.ts";

// Writing a heartbeat must never be able to take a worker down. Monitoring that
// crashes the thing it monitors is worse than no monitoring at all, so every
// write here is swallowed and logged. A missed beat degrades the row to
// "stale" on the dashboard, which is a true statement about a worker whose
// Mongo writes are failing.

export const workerId = () => `${hostname()}-${process.pid}`;

export type BeatInput = {
  id: string;
  kind: WorkerKind;
  state: WorkerState;
  currentLabel?: string | null;
  currentSince?: Date | null;
  processedThisRun?: number;
  failedThisRun?: number;
};

/** Upsert this worker's row. Never throws. */
export async function beat(input: BeatInput): Promise<void> {
  try {
    const now = new Date();
    await HeartbeatModel.updateOne(
      { _id: input.id },
      {
        $set: {
          kind: input.kind,
          host: hostname(),
          pid: process.pid,
          lastBeatAt: now,
          state: input.state,
          currentLabel: input.currentLabel ?? null,
          currentSince: input.currentSince ?? null,
          ...(input.processedThisRun === undefined
            ? {}
            : { processedThisRun: input.processedThisRun }),
          ...(input.failedThisRun === undefined ? {} : { failedThisRun: input.failedThisRun }),
        },
        // Only on insert, so a restart is visibly a new run rather than
        // inheriting the previous process's start time.
        $setOnInsert: { startedAt: now },
      },
      { upsert: true },
    );
  } catch (error) {
    console.error("heartbeat write failed (continuing):", error);
  }
}

/**
 * Beat on an interval so an idle worker still proves it is alive. Returns the
 * stop function; the caller owns the timer's lifetime.
 *
 * `unref` so a pending beat cannot hold the process open at shutdown.
 */
export function startBeating(read: () => BeatInput, everyMs: number): () => void {
  const timer = setInterval(() => void beat(read()), everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
