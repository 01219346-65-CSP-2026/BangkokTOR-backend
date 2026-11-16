import { Schema, model, type HydratedDocument, type InferSchemaType, type Types } from "mongoose";

/**
 * Who did what, to what, when (T21, Repudiation).
 *
 * One row per admin or user write (create, update, delete, pipeline run, queue
 * flush), written by middleware/audit.ts after the response. Request logs say
 * a write happened; this says WHO did it — the user id from the internal JWT,
 * or the identity of the token that authorised the call.
 *
 * Append-only. Nothing in the API updates or deletes a row, and the hooks
 * below make the model itself refuse to, so a future route cannot quietly
 * rewrite history either. Cleaning up is a deliberate act in the database
 * shell, not something the application can do.
 */

export const AUDIT_ACTOR_TYPES = ["user", "token"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

const auditLogSchema = new Schema(
  {
    // "user": `actorId` is the Mongo user _id from the internal JWT.
    // "token": `actorId` is a token identity, e.g. "admin-token" — a shared
    // secret names the credential, not the person, which is why user-signed
    // calls are preferred wherever the frontend can make them.
    actorType: { type: String, enum: AUDIT_ACTOR_TYPES, required: true, immutable: true },
    actorId: { type: String, required: true, immutable: true },
    // The token that also gated the call, when a signed-in user called a
    // token-gated route (the admin panel's queue flush, for example).
    viaToken: { type: String, default: null, immutable: true },

    // "<METHOD> <route pattern>", e.g. "DELETE /api/user/:id" — stable across
    // ids, so "every user deletion" is one query.
    action: { type: String, required: true, immutable: true },
    method: { type: String, required: true, immutable: true },
    // The concrete path, query string excluded (it may hold personal data).
    path: { type: String, required: true, immutable: true },
    // The route params, e.g. { id: "6650…" }. Empty for a route with none
    // (POST /api/ingest/run acts on the pipeline, not a row).
    target: { type: Schema.Types.Mixed, default: {}, immutable: true },

    // The HTTP status the write ended with. A refused or failed attempt by an
    // identified actor is still evidence, so it is kept, not filtered out.
    status: { type: Number, required: true, immutable: true },
    ip: { type: String, default: null, immutable: true },
    at: { type: Date, required: true, default: () => new Date(), immutable: true },
  },
  { versionKey: false, collection: "audit_log" },
);

auditLogSchema.index({ at: -1 });
auditLogSchema.index({ actorType: 1, actorId: 1, at: -1 });
auditLogSchema.index({ action: 1, at: -1 });

/** Thrown by every path that would change or remove an existing entry. */
export class AuditLogImmutableError extends Error {
  constructor(operation: string) {
    super(`audit_log is append-only: ${operation} is not allowed`);
    this.name = "AuditLogImmutableError";
  }
}

const MUTATING_QUERIES = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "replaceOne",
  "findOneAndReplace",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const;

for (const operation of MUTATING_QUERIES) {
  auditLogSchema.pre(operation, function () {
    throw new AuditLogImmutableError(operation);
  });
}

// document.deleteOne() / document.updateOne() on a loaded entry.
auditLogSchema.pre(["deleteOne", "updateOne"], { document: true, query: false }, function () {
  throw new AuditLogImmutableError("document write");
});

// save() on a loaded entry is an update; only the first save is allowed.
auditLogSchema.pre("save", function () {
  if (!this.isNew) throw new AuditLogImmutableError("save on an existing entry");
});

auditLogSchema.pre("bulkWrite", function () {
  throw new AuditLogImmutableError("bulkWrite");
});

export type AuditLog = InferSchemaType<typeof auditLogSchema>;
export type AuditLogDoc = HydratedDocument<AuditLog>;
export type AuditLogLean = AuditLog & { _id: Types.ObjectId };

export const AuditLogModel = model("AuditLog", auditLogSchema);
