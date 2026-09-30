import { describe, expect, test } from "bun:test";
import { env } from "../../config/env.ts";
import { isFlushable, NON_RETRYABLE_KINDS } from "./monitor.service.ts";
import { parseOversizeBytes } from "../ingest/ingest.service.ts";
import { logLine } from "../../lib/sources/outcome.ts";

describe("parseOversizeBytes", () => {
  test("reads the size back out of the message logLine writes", () => {
    const message = logLine({ ok: false, reason: "oversize", bytes: 200014417 });
    expect(parseOversizeBytes(message)).toBe(200014417);
  });

  test("null for any other message shape", () => {
    expect(parseOversizeBytes("not-a-zip")).toBeNull();
    expect(parseOversizeBytes("")).toBeNull();
    expect(parseOversizeBytes(null)).toBeNull();
  });
});

describe("isFlushable", () => {
  const now = Date.now();
  const silentFor = (ms: number) => new Date(now - ms);

  test("a live worker is never flushed, even one that is stopping", () => {
    expect(isFlushable({ lastBeatAt: silentFor(0), state: "idle" }, now)).toBe(false);
    expect(isFlushable({ lastBeatAt: silentFor(0), state: "stopping" }, now)).toBe(false);
  });

  test("a stale worker is kept unless it announced it was stopping", () => {
    const stale = silentFor(env.heartbeatMs * 3 + 1);
    expect(isFlushable({ lastBeatAt: stale, state: "working" }, now)).toBe(false);
    expect(isFlushable({ lastBeatAt: stale, state: "stopping" }, now)).toBe(true);
  });

  test("a dead worker is always flushed", () => {
    const dead = silentFor(env.workerLeaseMs + 1);
    expect(isFlushable({ lastBeatAt: dead, state: "working" }, now)).toBe(true);
  });
});

test("oversize is not retryable", () => {
  expect(NON_RETRYABLE_KINDS.has("oversize")).toBe(true);
});
