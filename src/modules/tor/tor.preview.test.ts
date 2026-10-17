import { describe, expect, test } from "bun:test";
import { buildPreviewFromRows, fitScore, type PreviewRow } from "./tor.preview.ts";

function row(id: string, skills: string[], budget: number | null = 1_000_000): PreviewRow {
  return { id, title: `TOR ${id}`, agency: null, budget, bidClosesAt: null, skills };
}

const base = { seed: "abc" };

describe("fitScore", () => {
  test("share of required skills, half-up; null when nothing is tagged", () => {
    expect(fitScore(1, 2)).toBe(50);
    expect(fitScore(1, 3)).toBe(33);
    expect(fitScore(2, 3)).toBe(67);
    expect(fitScore(0, 0)).toBeNull();
  });
});

describe("buildPreviewFromRows", () => {
  const rows = [
    row("a", ["react", "nodejs"]), // 50 with react
    row("b", ["react", "nodejs", "postgresql"]), // 33 with react
    row("c", ["python", "aiMl"]), // 0
    row("d", []), // untagged
  ];

  test("reach counts in-budget TORs at fit >= 40", () => {
    const p = buildPreviewFromRows(rows, { ...base, skills: ["react"] });
    expect(p.openCount).toBe(4);
    expect(p.reachableCount).toBe(1);
    expect(p.topMatches.map((m) => [m.id, m.fitScore])).toEqual([
      ["a", 50],
      ["b", 33],
    ]);
    expect(p.topMatchesAreRandom).toBe(false);
  });

  test("budget excludes out-of-range TORs; a missing budget is kept", () => {
    const priced = [row("a", ["react"], 5_000_000), row("b", ["react"], null)];
    const p = buildPreviewFromRows(priced, { ...base, skills: ["react"], maxBudget: 1_000_000 });
    expect(p.reachableCount).toBe(1);
    expect(p.topMatches.map((m) => m.id)).toEqual(["b"]);
  });

  test("suggestions: skills that tip TORs over the line, best first", () => {
    const p = buildPreviewFromRows(rows, { ...base, skills: ["react"] });
    // nodejs / postgresql take b from 33 to 67; aiMl / python take c from 0
    // to 50. a is already reached. Ties sort by slug, top 3 kept.
    expect(p.suggestions).toEqual([
      { slug: "aiMl", additionalReach: 1 },
      { slug: "nodejs", additionalReach: 1 },
      { slug: "postgresql", additionalReach: 1 },
    ]);
    // aiMl's best TOR lands at 50, no better than today's best.
    expect(p.nudge).toEqual({ slug: "aiMl", additionalReach: 1, fitFrom: 50, fitTo: 50 });
  });

  test("no skills: no suggestions, and a random pick that is stable per seed", () => {
    const many = Array.from({ length: 20 }, (_, i) => row(`t${i}`, ["react"]));
    const one = buildPreviewFromRows(many, { seed: "abc", skills: [] });
    const again = buildPreviewFromRows(many, { seed: "abc", skills: [] });
    const other = buildPreviewFromRows(many, { seed: "xyz", skills: [] });

    expect(one.topMatchesAreRandom).toBe(true);
    expect(one.topMatches).toHaveLength(3);
    expect(one.topMatches.every((m) => m.fitScore === null)).toBe(true);
    expect(again.topMatches).toEqual(one.topMatches);
    expect(other.topMatches.map((m) => m.id)).not.toEqual(one.topMatches.map((m) => m.id));
    expect(one.suggestions).toEqual([]);
    expect(one.nudge).toBeNull();
  });

  test("random fallback ignores budget so it isn't emptied by it", () => {
    const p = buildPreviewFromRows([row("a", ["python"], 9_000_000)], {
      ...base,
      skills: ["react"],
      maxBudget: 100,
    });
    expect(p.topMatchesAreRandom).toBe(true);
    expect(p.topMatches.map((m) => m.id)).toEqual(["a"]);
  });
});
