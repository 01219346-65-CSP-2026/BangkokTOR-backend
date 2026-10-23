import { describe, expect, test } from "bun:test";
import { load, source } from "./helpers.ts";

// PASSING CRITERIA for feat/116 (backend) — the wiring part.
// Run with:   bun test checklist/116
//
// The maths is specified in src/modules/tor/tor.insights.test.ts. This file
// checks that the maths is reachable: validated input → service → controller
// → route, in that order. Each test is one step in LEARNING.md.

describe("feat/116 checklist", () => {
  test("step 7: parseInsightsQuery turns the query string into typed input", async () => {
    const { parseInsightsQuery } = await load("src/modules/tor/tor.validation.ts");
    expect(parseInsightsQuery, "export parseInsightsQuery from tor.validation.ts").toBeFunction();
    expect(parseInsightsQuery({ province: " กรุงเทพมหานคร " })).toEqual({ province: "กรุงเทพมหานคร" });
    expect(parseInsightsQuery({})).toEqual({ province: undefined });
    expect(parseInsightsQuery({ province: "   " })).toEqual({ province: undefined });
    expect(parseInsightsQuery({ province: ["a", "b"] })).toEqual({ province: undefined });
    expect(parseInsightsQuery({ province: "x".repeat(200) })).toEqual({ province: undefined });
  });

  test("step 8: getInsights loads the public scope and hands it to buildInsights", () => {
    const service = source("src/modules/tor/tor.service.ts");
    expect(service).toContain("export async function getInsights");
    expect(service).toContain("buildInsights(");
    // Same rows the listings page shows — no back door around publicScope.
    const body = service.slice(service.indexOf("export async function getInsights"));
    expect(body).toContain("publicScope(");
    // Only the eight fields the graphs read. The full row carries the grade.
    expect(body).not.toMatch(/ruleFindings|grade\b|legitimacySignals/);
  });

  test("step 9: the controller exposes insights", async () => {
    const controller = await load("src/modules/tor/tor.controller.ts");
    expect(controller.insights, "export async function insights(req, res)").toBeFunction();
    expect(source("src/modules/tor/tor.controller.ts")).toContain("parseInsightsQuery(");
  });

  test("step 9: GET /insights is routed, and BEFORE /:id", async () => {
    const { torRouter } = await load("src/modules/tor/tor.route.ts");
    const paths: string[] = torRouter.stack
      .filter((layer: { route?: { path: string } }) => layer.route)
      .map((layer: { route: { path: string } }) => layer.route.path);

    expect(paths, "torRouter.get(\"/insights\", controller.insights)").toContain("/insights");
    // Otherwise Express reads "insights" as a TOR id and answers 404.
    expect(paths.indexOf("/insights")).toBeLessThan(paths.indexOf("/:id"));
  });
});
