import { describe, expect, test } from "bun:test";
import { HttpError } from "../../middleware/errors.ts";
import { parseListQuery } from "./tor.validation.ts";

describe("parseListQuery — length caps (Sec P11 / T19, T12)", () => {
  test("q over 200 characters is a 400, not a silent truncation", () => {
    expect(() => parseListQuery({ q: "a".repeat(201) })).toThrow(HttpError);
    try {
      parseListQuery({ q: "a".repeat(201) });
    } catch (err) {
      expect((err as HttpError).status).toBe(400);
    }
  });

  test("agency over 200 characters is a 400", () => {
    expect(() => parseListQuery({ agency: "a".repeat(201) })).toThrow(HttpError);
  });

  test("province over 64 characters is a 400", () => {
    expect(() => parseListQuery({ province: "a".repeat(65) })).toThrow(HttpError);
  });

  test("exactly at the limit is accepted, and whitespace is trimmed first", () => {
    expect(parseListQuery({ q: "a".repeat(200) }).q).toHaveLength(200);
    expect(parseListQuery({ agency: `  ${"a".repeat(200)}  ` }).agency).toHaveLength(200);
    expect(parseListQuery({ province: "a".repeat(64) }).province).toHaveLength(64);
  });
});

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
