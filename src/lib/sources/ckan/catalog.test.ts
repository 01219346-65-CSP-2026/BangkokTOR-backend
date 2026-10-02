import { describe, expect, test } from "bun:test";
import { fiscalYearFromTitle, pickDataset, PACKAGE_TITLE } from "./catalog.ts";

// Titles and slugs as data.go.th lists them (package_search, 2026-09-30).
const pkg = (id: string, year: number, resources: Array<[string, string, boolean]>) => ({
  id,
  title: `${PACKAGE_TITLE} ${year} ${id}`,
  resources: resources.map(([rid, name, datastore_active]) => ({ id: rid, name, datastore_active })),
});

describe("fiscalYearFromTitle", () => {
  test("reads the year whatever the slug says", () => {
    expect(fiscalYearFromTitle(`${PACKAGE_TITLE} 2568 egp-contact-2568`)).toBe(2568);
    expect(fiscalYearFromTitle(`${PACKAGE_TITLE} 2567`)).toBe(2567);
  });

  test("ignores look-alike packages", () => {
    expect(fiscalYearFromTitle("ข้อมูลผลสรุปโครงการจัดซื้อจัดจ้างจากระบบการจัดซื้อจัดจ้างภาครัฐ")).toBeNull();
    expect(fiscalYearFromTitle(undefined)).toBeNull();
  });
});

describe("pickDataset", () => {
  const packages = [
    pkg("cdg-contract-2567", 2567, [["a", "2567-1", true]]),
    pkg("egp-contact-2568", 2568, [
      ["r10", "2568-egp-contract-10", true],
      ["r2", "2568-egp-contract-2", true],
      ["r1", "2568-egp-contract-1", true],
      ["zip", "all.zip", false],
    ]),
    { id: "summary", title: "ข้อมูลผลสรุป", resources: [] },
  ];

  test("takes the newest year", () => {
    expect(pickDataset(packages)?.fiscalYear).toBe(2568);
  });

  test("orders resources naturally and drops non-datastore ones", () => {
    expect(pickDataset(packages)?.resourceIds).toEqual(["r1", "r2", "r10"]);
  });

  test("a pinned year wins over the newest", () => {
    expect(pickDataset(packages, 2567)?.packageId).toBe("cdg-contract-2567");
  });

  test("null when the pinned year isn't published", () => {
    expect(pickDataset(packages, 2569)).toBeNull();
  });
});
