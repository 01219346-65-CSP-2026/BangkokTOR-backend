import { hostname } from "node:os";
import type { Model } from "mongoose";
import { env } from "../../config/env.ts";
import { claimNext, release } from "../../modules/ingest/claim.ts";

// The claim -> process -> release loop, shared by the ingest and extraction
// workers. Both queues have the same shape on purpose, so the difference
// between the two processes is one model and one function.

export type WorkerResult = { ok: true; note?: string } | { ok: false; reason: string };

export type RunQueueOptions<TRow> = {
  name: string;
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
  const workerId = `${hostname()}-${process.pid}`;
  let running = true;
  let inFlight = false;

  async function loop() {
    console.log(`${options.name} ${workerId} started (lease ${env.workerLeaseMs}ms)`);

    let processed = 0;
    let idleLogged = false;

    while (running) {
      const row = (await claimNext(options.model, workerId, env.workerLeaseMs)) as TRow | null;

      if (!row) {
        if (!idleLogged) {
          console.log("queue empty — waiting");
          idleLogged = true;
        }
        await sleep(env.workerIdleMs);
        continue;
      }

      idleLogged = false;
      inFlight = true;

      try {
        const result = await options.process(row);
        await release(options.model, row as never, result);
        processed++;
        const note = result.ok && result.note ? ` (${result.note})` : "";
        console.log(
          `${result.ok ? "ok  " : "fail"} ${options.label(row)}${note}  ` +
            `(attempt ${row.attempts ?? "?"}, ${processed} done this run)`,
        );
      } catch (error) {
        // An unexpected throw still has to release the row, or it sits at
        // "working" until the lease expires and wastes a lease period.
        await options.onError?.(row, String(error));
        await release(options.model, row as never, { ok: false, reason: String(error) });
        console.error(`throw ${options.label(row)}:`, error);
      } finally {
        inFlight = false;
      }
    }

    console.log(`${options.name} ${workerId} stopped after ${processed} rows`);
  }

  // A clean stop finishes the current row first. A crash doesn't get to — that
  // case is covered by the lease, which is the whole reason claimedAt exists.
  async function shutdown(signal: string) {
    console.log(`\n${signal} — finishing current row, then stopping`);
    running = false;
    const deadline = Date.now() + 30_000;
    while (inFlight && Date.now() < deadline) await sleep(200);
  }

  return { loop, shutdown };
}
