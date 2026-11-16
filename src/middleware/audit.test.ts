import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import express, { Router, type RequestHandler } from "express";
import type { Server } from "node:http";
import { auditWrites, resolveActor, routeOf } from "./audit.ts";
import { HttpError, errorHandler } from "./errors.ts";
import { AuditLogModel } from "../modules/audit/audit.model.ts";

// A real Express app, so the route pattern and params are read the way they
// are in production — including after a handler throws into the error handler.

const asUser = (id: string): RequestHandler => (_req, res, next) => {
  res.locals.userId = id;
  next();
};
const asToken = (identity: string): RequestHandler => (_req, res, next) => {
  res.locals.tokenIdentity = identity;
  next();
};

const users = Router();
users.delete("/:id", asToken("admin-token"), (_req, res) => {
  res.json({ ok: true });
});
users.patch("/:id", asToken("admin-token"), () => {
  throw new HttpError(404, "User not found");
});
users.post("/", (_req, res) => {
  // No auth ran: an anonymous write.
  res.status(201).json({ ok: true });
});

const me = Router();
me.use(asUser("user-123"));
me.put("/bookmarks/:torId", (_req, res) => {
  res.json({ saved: true });
});
me.get("/bookmarks", (_req, res) => {
  res.json({ items: [] });
});

const pipeline = Router();
pipeline.use(asUser("admin-user-1"));
pipeline.post("/workers/flush", asToken("admin-token"), (_req, res) => {
  res.json({ flushed: 2 });
});

const app = express();
app.use(express.json());
app.use(auditWrites);
app.use("/api/user", users);
app.use("/api/me", me);
app.use("/api/pipeline", pipeline);
app.use(errorHandler);

let server: Server;
let base = "";
let created: Array<Record<string, unknown>> = [];
const create = spyOn(AuditLogModel, "create").mockImplementation((async (doc: Record<string, unknown>) => {
  created.push(doc);
  return doc;
}) as never);

beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
  create.mockRestore();
});

afterEach(() => {
  created = [];
});

/** The insert runs after the response, so give it a tick to land. */
async function call(method: string, path: string): Promise<Response> {
  const res = await fetch(`${base}${path}`, { method });
  await res.text();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

describe("auditWrites", () => {
  test("an admin-token delete records the token, the route pattern and the target", async () => {
    await call("DELETE", "/api/user/abc123");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      actorType: "token",
      actorId: "admin-token",
      viaToken: null,
      action: "DELETE /api/user/:id",
      method: "DELETE",
      path: "/api/user/abc123",
      target: { id: "abc123" },
      status: 200,
    });
    expect(created[0]!.at).toBeInstanceOf(Date);
  });

  test("a user write records the user id from the internal JWT", async () => {
    await call("PUT", "/api/me/bookmarks/tor-9");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      actorType: "user",
      actorId: "user-123",
      action: "PUT /api/me/bookmarks/:torId",
      target: { torId: "tor-9" },
    });
  });

  test("a signed-in admin calling a token-gated route is recorded as the user, via the token", async () => {
    await call("POST", "/api/pipeline/workers/flush");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      actorType: "user",
      actorId: "admin-user-1",
      viaToken: "admin-token",
      action: "POST /api/pipeline/workers/flush",
      target: {},
    });
  });

  test("a failed write by an identified actor is still recorded, with its status", async () => {
    await call("PATCH", "/api/user/missing");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      actorId: "admin-token",
      action: "PATCH /api/user/:id",
      target: { id: "missing" },
      status: 404,
    });
  });

  test("exactly one entry per write", async () => {
    await call("DELETE", "/api/user/once");
    expect(created).toHaveLength(1);
  });

  test("reads are not audited", async () => {
    await call("GET", "/api/me/bookmarks");
    expect(created).toEqual([]);
  });

  test("a write with no identified actor is left to the request log", async () => {
    await call("POST", "/api/user");
    expect(created).toEqual([]);
  });

  test("the query string never reaches the entry", async () => {
    await call("DELETE", "/api/user/abc?token=secret-value&email=person%40example.com");
    expect(created[0]!.path).toBe("/api/user/abc");
    expect(JSON.stringify(created[0])).not.toContain("secret-value");
  });

  test("a failed insert does not break the response", async () => {
    create.mockImplementationOnce((async () => {
      throw new Error("mongo down");
    }) as never);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await call("DELETE", "/api/user/abc");
      expect(res.status).toBe(200);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("resolveActor", () => {
  test("prefers the user id over the token", () => {
    expect(resolveActor({ userId: "u1", tokenIdentity: "admin-token" })).toEqual({
      actorType: "user",
      actorId: "u1",
      viaToken: "admin-token",
    });
  });

  test("falls back to the token identity", () => {
    expect(resolveActor({ tokenIdentity: "admin-token" })).toEqual({
      actorType: "token",
      actorId: "admin-token",
      viaToken: null,
    });
  });

  test("returns null when nothing identified the caller", () => {
    expect(resolveActor({})).toBeNull();
    expect(resolveActor({ userId: "", tokenIdentity: 42 })).toBeNull();
  });
});

describe("routeOf", () => {
  test("lines the pattern up with the tail of the path", () => {
    expect(routeOf("DELETE", "/:id", "/api/user/abc")).toEqual({
      action: "DELETE /api/user/:id",
      target: { id: "abc" },
    });
    expect(routeOf("POST", "/errors/:id/retry", "/api/pipeline/errors/e1/retry")).toEqual({
      action: "POST /api/pipeline/errors/:id/retry",
      target: { id: "e1" },
    });
  });

  test("falls back to the concrete path when the pattern cannot be lined up", () => {
    expect(routeOf("POST", undefined, "/api/x")).toEqual({ action: "POST /api/x", target: {} });
    expect(routeOf("POST", "/*splat", "/api/x")).toEqual({ action: "POST /api/x", target: {} });
    expect(routeOf("POST", "/a/b/c", "/x")).toEqual({ action: "POST /x", target: {} });
    expect(routeOf("POST", "/run", "/api/ingest/capture")).toEqual({ action: "POST /api/ingest/capture", target: {} });
  });

  test("keeps a malformed escape raw instead of throwing", () => {
    expect(routeOf("DELETE", "/:id", "/api/user/%E0%A4%A")).toEqual({
      action: "DELETE /api/user/:id",
      target: { id: "%E0%A4%A" },
    });
  });
});
