import { describe, expect, test } from "bun:test";
import type { Request, Response } from "express";
import { HttpError } from "./errors.ts";
import { requireRole } from "./requireRole.ts";

function fakeRes(role: string | undefined): Response {
  return { locals: { role } } as unknown as Response;
}

describe("requireRole", () => {
  test("calls next with no error when the resolved role matches", () => {
    const calls: unknown[] = [];
    const next = (err?: unknown) => {
      calls.push(err);
    };

    requireRole("admin")({} as Request, fakeRes("admin"), next);

    expect(calls).toEqual([undefined]);
  });

  test("calls next with a 403 HttpError when the resolved role does not match", () => {
    const calls: unknown[] = [];
    const next = (err?: unknown) => {
      calls.push(err);
    };

    requireRole("admin")({} as Request, fakeRes("client"), next);

    expect(calls).toHaveLength(1);
    const err = calls[0];
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(403);
  });

  test("calls next with a 403 HttpError when no role was resolved at all", () => {
    const calls: unknown[] = [];
    const next = (err?: unknown) => {
      calls.push(err);
    };

    requireRole("admin")({} as Request, fakeRes(undefined), next);

    expect(calls).toHaveLength(1);
    expect((calls[0] as HttpError).status).toBe(403);
  });
});
