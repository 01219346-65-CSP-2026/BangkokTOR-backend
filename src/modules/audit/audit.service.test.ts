import { describe, expect, spyOn, test } from "bun:test";
import { Types } from "mongoose";
import { AuditLogModel } from "./audit.model.ts";
import { listAuditEntries } from "./audit.service.ts";

function stubFind(rows: unknown[]) {
  const calls: { filter?: unknown; sort?: unknown; limit?: number } = {};
  const find = spyOn(AuditLogModel, "find").mockImplementation(((filter: unknown) => {
    calls.filter = filter;
    const chain = {
      sort: (s: unknown) => ((calls.sort = s), chain),
      limit: (n: number) => ((calls.limit = n), chain),
      lean: () => chain,
      exec: async () => rows,
    };
    return chain;
  }) as never);
  return { find, calls };
}

describe("listAuditEntries", () => {
  test("newest first, IP left out of the response", async () => {
    const { find, calls } = stubFind([
      {
        _id: new Types.ObjectId(),
        actorType: "user",
        actorId: "u1",
        viaToken: "admin-token",
        action: "POST /api/pipeline/workers/flush",
        method: "POST",
        path: "/api/pipeline/workers/flush",
        target: {},
        status: 200,
        ip: "203.0.113.9",
        at: new Date("2026-11-01T00:00:00Z"),
      },
    ]);
    try {
      const out = await listAuditEntries({});
      expect(calls.sort).toEqual({ at: -1 });
      expect(calls.limit).toBe(50);
      expect(out.items[0]).toMatchObject({ actorId: "u1", viaToken: "admin-token", at: "2026-11-01T00:00:00.000Z" });
      expect(JSON.stringify(out)).not.toContain("203.0.113.9");
    } finally {
      find.mockRestore();
    }
  });

  test("limit is clamped to 1..200", async () => {
    const { find, calls } = stubFind([]);
    try {
      await listAuditEntries({ limit: 10_000 });
      expect(calls.limit).toBe(200);
      await listAuditEntries({ limit: -5 });
      expect(calls.limit).toBe(1);
    } finally {
      find.mockRestore();
    }
  });

  test("filters are exact string matches only", async () => {
    const { find, calls } = stubFind([]);
    try {
      await listAuditEntries({ actorId: "u1", action: "DELETE /api/user/:id" });
      expect(calls.filter).toEqual({ actorId: "u1", action: "DELETE /api/user/:id" });
      await listAuditEntries({});
      expect(calls.filter).toEqual({});
    } finally {
      find.mockRestore();
    }
  });
});
