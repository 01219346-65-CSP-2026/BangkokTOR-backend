import type { Model } from "mongoose";
import { env } from "../../config/env.ts";
import { claimNext, release } from "../../modules/ingest/claim.ts";
import type { WorkerKind } from "../../modules/monitor/heartbeat.model.ts";
import { beat, startBeating, workerId as makeWorkerId } from "../../modules/monitor/heartbeat.service.ts";

// The claim -> process -> release loop, shared by the ingest and extraction
// workers. Both queues have the same shape on purpose, so the difference
// between the two processes is one model and one function.

export type WorkerResult = { ok: true; note?: string } | { ok: false; reason: string };

export type RunQueueOptions<TRow> = {
  name: string;
  /** Which stage this is, for the monitoring dashboard. */
  kind: WorkerKind;
  model: Model<any>;
  process: (row: TRow) => Promise<WorkerResult>;
  onError?: (row: TRow, message: string) => Promise<void>;
  /** Identifies the row in log lines. */
  label: (row: TRow) => string;
};

export type QueueRunner = {
  loop: () => Promise<void>;
  shutdown: (signal: string) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createRunner<TRow extends { attempts?: number }>(
  options: RunQueueOptions<TRow>,
): QueueRunner {
  const workerId = makeWorkerId();
  let running = true;
  let inFlight = false;

  // Mirrored into every heartbeat, so the dashboard reads the same numbers the
  // final log line reports.
  let processed = 0;
  let failed = 0;
  let state: "idle" | "working" | "stopping" = "idle";
  let currentLabel: string | null = null;
  let currentSince: Date | null = null;

  const snapshot = () => ({
    id: workerId,
    kind: options.kind,
    state,
    currentLabel,
    currentSince,
    processedThisRun: processed,
    failedThisRun: failed,
  });

  async function loop() {
    console.log(`${options.name} ${workerId} started (lease ${env.workerLeaseMs}ms)`);

    let idleLogged = false;

    // An idle worker writes nothing to the queue, so without a ticking beat it
    // would be indistinguishable from a dead one.
    await beat(snapshot());
    const stopBeating = startBeating(snapshot, env.heartbeatMs);

    try {
      while (running) {
        const row = (await claimNext(options.model, workerId, env.workerLeaseMs)) as TRow | null;

        if (!row) {
          if (!idleLogged) {
            console.log("queue empty — waiting");
            idleLogged = true;
          }
          state = "idle";
          currentLabel = null;
          currentSince = null;
          await sleep(env.workerIdleMs);
          continue;
        }

        idleLogged = false;
        inFlight = true;
        state = "working";
        currentLabel = options.label(row);
        currentSince = new Date();
        await beat(snapshot());

        try {
          const result = await options.process(row);
          await release(options.model, row as never, result);
          processed++;
          if (!result.ok) failed++;
          const note = result.ok && result.note ? ` (${result.note})` : "";
          console.log(
            `${result.ok ? "ok  " : "fail"} ${options.label(row)}${note}  ` +
              `(attempt ${row.attempts ?? "?"}, ${processed} done this run)`,
          );
        } catch (error) {
          // An unexpected throw still has to release the row, or it sits at
          // "working" until the lease expires and wastes a lease period.
          failed++;
          await options.onError?.(row, String(error));
          await release(options.model, row as never, { ok: false, reason: String(error) });
          console.error(`throw ${options.label(row)}:`, error);
        } finally {
          inFlight = false;
          // Only fall back to idle if we are still running. A shutdown has
          // already set "stopping", and clobbering that would report a worker
          // on its way out as an idle healthy one.
          if (running) state = "idle";
          currentLabel = null;
          currentSince = null;
          await beat(snapshot());
        }
      }
    } finally {
      stopBeating();
      // Last word: the process is leaving. Without this the row would sit at
      // "idle"/"live" until the beats aged out, reporting a stopped worker as
      // a healthy one for the length of the stale window.
      state = "stopping";
      currentLabel = null;
      currentSince = null;
      await beat(snapshot());
    }

    console.log(`${options.name} ${workerId} stopped after ${processed} rows`);
  }

  // A clean stop finishes the current row first. A crash doesn't get to — that
  // case is covered by the lease, which is the whole reason claimedAt exists.
  async function shutdown(signal: string) {
    console.log(`\n${signal} — finishing current row, then stopping`);
    running = false;
    state = "stopping";
    await beat(snapshot());
    const deadline = Date.now() + 30_000;
    while (inFlight && Date.now() < deadline) await sleep(200);
  }

  return { loop, shutdown };
}
