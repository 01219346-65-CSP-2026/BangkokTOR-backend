import { describe, expect, test } from "bun:test";
import type { CkanPage } from "./client.ts";
import { discover } from "./index.ts";

// Two resources of 3 and 2 rows, paged 2 at a time by a fake fetcher that
// records every call, so the resume logic is visible without a network.
const ROWS: Record<string, string[]> = { r1: ["a", "b", "c"], r2: ["d", "e"] };

function fakeFetch(calls: string[]) {
  return async (resourceId: string, offset: number, _limit?: number, filters?: Record<string, string>): Promise<CkanPage> => {
    calls.push(`${resourceId}@${offset} ${JSON.stringify(filters)}`);
    const all = ROWS[resourceId] ?? [];
    return {
      total: all.length,
      fields: [],
      records: all.slice(offset, offset + 2).map((id) => ({ "รหัสโครงการ": id, "ชื่อโครงการ": `project ${id}` })),
    };
  };
}

async function collect(cursor: Parameters<typeof discover>[1], calls: string[]) {
  const ids: string[] = [];
  const dataset = { fiscalYear: 2568, packageId: "p", resourceIds: ["r1", "r2"] };
  for await (const raw of discover(dataset, cursor, undefined, fakeFetch(calls))) ids.push(raw.projectId);
  return ids;
}

describe("discover — across resources", () => {
  test("scans every resource, filtered on the fiscal year", async () => {
    const calls: string[] = [];
    expect(await collect({}, calls)).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls.every((c) => c.includes('{"ปีงบประมาณ":"2568"}'))).toBe(true);
  });

  test("resumes inside the resource the cursor names, skipping earlier ones", async () => {
    const calls: string[] = [];
    const ids = await collect({ fiscalYear: 2568, resourceId: "r2", lastOffset: 1 }, calls);
    expect(ids).toEqual(["e"]);
    expect(calls[0]).toStartWith("r2@1");
  });

  test("a cursor from another year starts over", async () => {
    const calls: string[] = [];
    const ids = await collect({ fiscalYear: 2567, resourceId: "r2", lastOffset: 1 }, calls);
    expect(ids).toEqual(["a", "b", "c", "d", "e"]);
  });
});
