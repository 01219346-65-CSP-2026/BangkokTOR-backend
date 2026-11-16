import { describe, expect, test } from "bun:test";
import { Types } from "mongoose";
import { AuditLogImmutableError, AuditLogModel } from "./audit.model.ts";

// The pre-hooks throw before Mongoose touches the connection, so these run
// without a database: an attempt to change history fails at the model.

function entry() {
  return AuditLogModel.hydrate({
    _id: new Types.ObjectId(),
    actorType: "token",
    actorId: "admin-token",
    viaToken: null,
    action: "DELETE /api/user/:id",
    method: "DELETE",
    path: "/api/user/abc",
    target: { id: "abc" },
    status: 200,
    ip: null,
    at: new Date("2026-11-01T00:00:00Z"),
  });
}

describe("audit_log is append-only", () => {
  const queries: Array<[string, () => Promise<unknown>]> = [
    ["updateOne", () => AuditLogModel.updateOne({}, { actorId: "someone-else" }).exec()],
    ["updateMany", () => AuditLogModel.updateMany({}, { status: 200 }).exec()],
    ["findOneAndUpdate", () => AuditLogModel.findOneAndUpdate({}, { actorId: "x" }).exec()],
    ["replaceOne", () => AuditLogModel.replaceOne({}, { actorId: "x" }).exec()],
    ["findOneAndReplace", () => AuditLogModel.findOneAndReplace({}, { actorId: "x" }).exec()],
    ["deleteOne", () => AuditLogModel.deleteOne({}).exec()],
    ["deleteMany", () => AuditLogModel.deleteMany({}).exec()],
    ["findOneAndDelete", () => AuditLogModel.findOneAndDelete({}).exec()],
    ["bulkWrite", () => AuditLogModel.bulkWrite([{ deleteMany: { filter: {} } }])],
  ];

  for (const [name, run] of queries) {
    test(`${name} is refused`, async () => {
      await expect(run()).rejects.toBeInstanceOf(AuditLogImmutableError);
    });
  }

  test("saving a loaded entry is refused", async () => {
    const doc = entry();
    doc.status = 500;
    await expect(doc.save()).rejects.toBeInstanceOf(AuditLogImmutableError);
  });

  test("deleting a loaded entry is refused", async () => {
    await expect(entry().deleteOne().exec()).rejects.toBeInstanceOf(AuditLogImmutableError);
  });

  test("every field is immutable once set", () => {
    const doc = entry();
    doc.actorId = "someone-else";
    doc.at = new Date();
    expect(doc.actorId).toBe("admin-token");
    expect(doc.at.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});
