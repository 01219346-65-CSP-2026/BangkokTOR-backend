import { describe, expect, test } from "bun:test";
import { parseListQuery } from "./tor.validation.ts";

describe("parseListQuery — best match", () => {
  test("keeps known skill slugs, drops unknown ones and duplicates", () => {
    expect(parseListQuery({ skills: "react,nope,gisQgis,react" }).skills).toEqual(["react", "gisQgis"]);
  });

  test("no known skills is no skills, not an empty filter", () => {
    expect(parseListQuery({ skills: "nope" }).skills).toBeUndefined();
    expect(parseListQuery({}).skills).toBeUndefined();
  });

  test("fit bands are whitelisted", () => {
    expect(parseListQuery({ fit: "strong,bogus,weak" }).fit).toEqual(["strong", "weak"]);
    expect(parseListQuery({ fit: "bogus" }).fit).toBeUndefined();
  });

  test("bestMatch is an accepted sort", () => {
    expect(parseListQuery({ sort: "bestMatch" }).sort).toBe("bestMatch");
  });
});
