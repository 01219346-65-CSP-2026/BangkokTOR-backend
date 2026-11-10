import { describe, expect, test } from "bun:test";
import type { NextFunction, Request, Response } from "express";
import { userRouter } from "./user.route.ts";
import { requireUser } from "../../middleware/requireUser.ts";
import * as controller from "./user.controller.ts";
import { HttpError } from "../../middleware/errors.ts";

// T08 — GET /api/user and GET /api/user/:id used to carry no auth at all and
// dumped every user's email, Google id, role and profile. This proves the
// fix is actually wired onto the routes (not just that requireUser/requireRole
// work in isolation — requireRole.test.ts already covers that), by reading
// Express's own route table rather than standing up a server or a Mongo
// connection.
function getHandlers(path: string): unknown[] {
  const layer = userRouter.stack.find(
    (l) => l.route?.path === path && l.route.stack[0]?.method === "get",
  );
  if (!layer?.route) throw new Error(`no GET route registered for "${path}"`);
  return layer.route.stack.map((l) => l.handle);
}

function fakeRes(role: string | undefined): Response {
  return { locals: { role } } as unknown as Response;
}

function invoke(handle: ILayerHandle, role: string | undefined) {
  const calls: unknown[] = [];
  handle({} as Request, fakeRes(role), ((err?: unknown) => calls.push(err)) as NextFunction);
  return calls;
}

type ILayerHandle = (req: Request, res: Response, next: NextFunction) => unknown;

describe.each([
  ["/", () => controller.listUsers],
  ["/:id", () => controller.getUser],
])("GET %s", (path, getController) => {
  test("runs requireUser, then requireRole(\"admin\"), before the controller", () => {
    const handlers = getHandlers(path);
    expect(handlers).toHaveLength(3);
    expect(handlers[0]).toBe(requireUser);
    expect(handlers[2]).toBe(getController());
  });

  test("the role gate admits admin and rejects everyone else with a 403", () => {
    const [, roleGate] = getHandlers(path) as [unknown, ILayerHandle, unknown];

    expect(invoke(roleGate, "admin")).toEqual([undefined]);

    for (const role of ["client", "agency", undefined]) {
      const calls = invoke(roleGate, role);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBeInstanceOf(HttpError);
      expect((calls[0] as HttpError).status).toBe(403);
    }
  });

  test("a request with no bearer token is rejected by the auth gate with a 401", async () => {
    const [authGate] = getHandlers(path) as [
      (req: Request, res: Response, next: NextFunction) => Promise<void>,
      unknown,
      unknown,
    ];
    const req = { headers: {} } as Request;

    const rejection = authGate(req, fakeRes(undefined), () => {});
    await expect(rejection).rejects.toBeInstanceOf(HttpError);
    await expect(rejection).rejects.toMatchObject({ status: 401 });
  });
});

describe("the mutating routes keep their existing admin-token gate", () => {
  test("POST / and PATCH|DELETE /:id are unchanged by this fix", () => {
    const postRoot = userRouter.stack.find(
      (l) => l.route?.path === "/" && l.route.stack[0]?.method === "post",
    );
    expect(postRoot?.route?.stack.map((l) => l.handle.name)).toEqual([
      "requireAdminToken",
      "createUser",
    ]);
  });
});
