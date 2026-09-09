import type { Request, Response } from "express";
import * as service from "./tor.service.ts";
import { parseListQuery } from "./tor.validation.ts";

/** Express 5 types a route param as string | string[]; a repeated :id is not
 *  a valid id, so the array form is collapsed to nothing rather than guessed. */
function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export async function list(req: Request, res: Response) {
  res.json(await service.listTors(parseListQuery(req.query as Record<string, unknown>)));
}

export async function detail(req: Request, res: Response) {
  const tor = await service.getTor(param(req.params.id));
  if (!tor) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(tor);
}

// The full grade, including evidence quotes. Separate route so the public list
// cannot leak it — mount behind auth when FR-01 lands.
export async function grade(req: Request, res: Response) {
  const grade = await service.getTorGrade(param(req.params.id));
  if (!grade) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(grade);
}

export async function agencies(_req: Request, res: Response) {
  res.json(await service.listAgencies());
}

export async function stats(_req: Request, res: Response) {
  res.json(await service.getStats());
}
