import type { Request, RequestHandler } from "express";
import { AuditLogModel, type AuditActorType } from "../modules/audit/audit.model.ts";

/**
 * Writes one audit_log entry per admin or user write (T21, Repudiation).
 *
 * Mounted once in front of every API router (routes/index.ts), so a new write
 * route is audited without anyone remembering to add it. It reads the actor
 * AFTER the response, from what the auth middleware already resolved:
 *
 *   res.locals.userId         set by requireUser — the internal JWT's user
 *   res.locals.tokenIdentity  set by requireAdminToken (and, later, the
 *                             separate capture token) — names the credential
 *
 * A write nobody was identified for — refused by a rate limit, or a wrong
 * token answered with 404 before any auth passed — is not an admin or user
 * write and is left to the request log, so an anonymous caller cannot fill
 * this collection.
 *
 * The entry is written after the response. Auditing never fails a request
 * that already succeeded; a failed insert is logged loudly instead.
 */

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type AuditActor = { actorType: AuditActorType; actorId: string; viaToken: string | null };

/** The user id wins over the token: it names a person, the token a credential. */
export function resolveActor(locals: Record<string, unknown>): AuditActor | null {
  const userId = typeof locals.userId === "string" && locals.userId ? locals.userId : null;
  const token =
    typeof locals.tokenIdentity === "string" && locals.tokenIdentity ? locals.tokenIdentity : null;

  if (userId) return { actorType: "user", actorId: userId, viaToken: token };
  if (token) return { actorType: "token", actorId: token, viaToken: null };
  return null;
}

function pathOf(req: Request): string {
  const url = req.originalUrl ?? req.url ?? "";
  const queryAt = url.indexOf("?");
  return queryAt === -1 ? url : url.slice(0, queryAt);
}

/**
 * "DELETE /api/user/:id" and { id: "6650…" }, rebuilt from the matched route's
 * pattern and the concrete path.
 *
 * Not from req.baseUrl/req.params: Express restores those when a router hands
 * an error to the error handler, so a failed write would be logged as
 * "PATCH /:id" with no target. req.route survives, and the pattern's segments
 * line up with the tail of the path. A pattern this cannot line up (wildcards,
 * optional groups) falls back to the concrete path.
 */
export function routeOf(
  method: string,
  pattern: unknown,
  path: string,
): { action: string; target: Record<string, string> } {
  const fallback = { action: `${method} ${path}`, target: {} };
  if (typeof pattern !== "string" || /[*{}()?]/.test(pattern)) return fallback;

  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length > pathParts.length) return fallback;

  const offset = pathParts.length - patternParts.length;
  const target: Record<string, string> = {};
  for (const [i, part] of patternParts.entries()) {
    const actual = pathParts[offset + i]!;
    if (part.startsWith(":")) {
      try {
        target[part.slice(1)] = decodeURIComponent(actual);
      } catch {
        // Malformed %-encoding: keep it raw rather than lose the entry.
        target[part.slice(1)] = actual;
      }
    } else if (part !== actual) {
      return fallback;
    }
  }

  const prefix = pathParts.slice(0, offset);
  return { action: `${method} /${[...prefix, ...patternParts].join("/")}`, target };
}

export const auditWrites: RequestHandler = (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) {
    next();
    return;
  }

  let written = false;
  const record = () => {
    if (written) return;
    written = true;
    const actor = resolveActor(res.locals as Record<string, unknown>);
    if (!actor) return;

    const path = pathOf(req);
    const { action, target } = routeOf(req.method, req.route?.path, path);
    void AuditLogModel.create({
      ...actor,
      action,
      method: req.method,
      path,
      target,
      // A response that never finished (client hung up) has no real status.
      status: res.writableFinished ? res.statusCode : 499,
      ip: req.ip ?? null,
      at: new Date(),
    }).catch((err: unknown) => {
      console.error(`[audit] failed to record ${req.method} ${path}:`, err);
    });
  };

  // "finish" for a completed response, "close" for one the client abandoned.
  res.on("finish", record);
  res.on("close", record);
  next();
};
