import { AuditLogModel } from "./audit.model.ts";

export type AuditEntryJSON = {
  id: string;
  actorType: string;
  actorId: string;
  viaToken: string | null;
  action: string;
  method: string;
  path: string;
  target: Record<string, unknown>;
  status: number;
  at: string;
};

const MAX_LIMIT = 200;

/**
 * Newest first, for the admin panel (T21). Filters are exact matches on
 * strings — `String()`-coerced by the controller, so a query-object injection
 * like `?actorId[$ne]=x` arrives as the literal "[object Object]", not an
 * operator. The IP is left out of the response: it is evidence for an
 * investigation in the database, not something the panel needs to show.
 */
export async function listAuditEntries(opts: {
  limit?: number;
  actorId?: string;
  action?: string;
}): Promise<{ items: AuditEntryJSON[] }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), MAX_LIMIT);
  const filter: Record<string, string> = {};
  if (opts.actorId) filter.actorId = opts.actorId;
  if (opts.action) filter.action = opts.action;

  const rows = await AuditLogModel.find(filter).sort({ at: -1 }).limit(limit).lean().exec();

  return {
    items: rows.map((row) => ({
      id: String(row._id),
      actorType: row.actorType,
      actorId: row.actorId,
      viaToken: row.viaToken ?? null,
      action: row.action,
      method: row.method,
      path: row.path,
      target: (row.target ?? {}) as Record<string, unknown>,
      status: row.status,
      at: row.at.toISOString(),
    })),
  };
}
