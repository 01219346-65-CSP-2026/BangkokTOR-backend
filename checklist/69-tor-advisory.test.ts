import { describe, expect, test } from "bun:test";
import { source } from "./helpers.ts";

// PASSING CRITERIA for feat/69 — the wiring part.
// Run with:   bun test checklist/69

describe("feat/69 checklist", () => {
  test("the advisory route is behind sign-in", () => {
    const routes = source("src/modules/tor/tor.route.ts");
    expect(routes).toContain('torRouter.get("/:id/advisory", requireUser, profileLimit, controller.advisory)');
  });

  test("the public serializer still keeps findings off its shape", () => {
    // The gate is an allowlist (T09): the grade fields must never be named in it.
    const serializer = source("src/modules/tor/tor.serialize.ts");
    const start = serializer.indexOf("export const PUBLIC_TOR_FIELDS");
    const gate = serializer.slice(start, serializer.indexOf("as const", start));
    expect(start).toBeGreaterThan(-1);
    expect(serializer).not.toContain("...rest");
    expect(gate).not.toContain('"ruleFindings"');
    expect(gate).not.toContain('"grade"');
    expect(gate).not.toContain('"gradeScore"');
  });

  test("the advisory reads only TORs the public can open", () => {
    const service = source("src/modules/tor/tor.service.ts");
    const body = service.slice(service.indexOf("export async function getTorAdvisory"), service.indexOf("export async function listAgencies"));
    expect(body).toContain("publicScope()");
    expect(body).toContain("serializeAdvisory");
  });
});
