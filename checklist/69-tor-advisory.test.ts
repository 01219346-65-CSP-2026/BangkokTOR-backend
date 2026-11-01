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
    const serializer = source("src/modules/tor/tor.serialize.ts");
    const gate = serializer.slice(serializer.indexOf("PRIVATE_GRADE_FIELDS"), serializer.indexOf("as const"));
    expect(gate).toContain('"ruleFindings"');
    expect(gate).toContain('"grade"');
  });

  test("the advisory reads only TORs the public can open", () => {
    const service = source("src/modules/tor/tor.service.ts");
    const body = service.slice(service.indexOf("export async function getTorAdvisory"), service.indexOf("export async function listAgencies"));
    expect(body).toContain("publicScope()");
    expect(body).toContain("serializeAdvisory");
  });
});
