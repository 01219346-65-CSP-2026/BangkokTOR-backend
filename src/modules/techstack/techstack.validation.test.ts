import { describe, expect, test } from "bun:test";
import { HttpError } from "../../middleware/errors.ts";
import {
  parseCreateTechstack,
  parseListTechstacks,
  parseUpdateTechstack,
} from "./techstack.validation.ts";

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "no throw";
  } catch (err) {
    return err instanceof HttpError ? err.status : "wrong error type";
  }
}

// This module's schema was a verbatim copy of notification's — user_id, title,
// message, is_read — so a tech stack could not be created by name at all.
// These tests pin the shape it should always have had.
describe("parseCreateTechstack", () => {
  test("a tech stack is a name", () => {
    expect(parseCreateTechstack({ name: "React" })).toEqual({ name: "React", category: null });
  });

  test("requires the name", () => {
    expect(status(() => parseCreateTechstack({}))).toBe(400);
    expect(status(() => parseCreateTechstack({ name: "   " }))).toBe(400);
  });

  test("does not accept the notification fields it used to demand", () => {
    const out = parseCreateTechstack({
      name: "PostgreSQL",
      user_id: "6aa51ee3c3f15ca4cda033df",
      title: "leftover",
      is_read: true,
    }) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(["category", "name"]);
  });

  test("trims and keeps an optional category", () => {
    expect(parseCreateTechstack({ name: "  Docker ", category: " infra " })).toEqual({
      name: "Docker",
      category: "infra",
    });
  });
});

describe("parseUpdateTechstack", () => {
  test("requires at least one field", () => {
    expect(status(() => parseUpdateTechstack({}))).toBe(400);
  });

  test("omits fields the caller did not send, so $set cannot blank them", () => {
    expect(parseUpdateTechstack({ name: "Vue" })).toEqual({ name: "Vue" });
  });
});

describe("parseListTechstacks", () => {
  test("whitelists sort", () => {
    expect(status(() => parseListTechstacks({ sort: "name; drop" }))).toBe(400);
    expect(parseListTechstacks({ sort: "-name" }).sort).toBe("-name");
  });

  test("defaults to alphabetical, which is what a vocabulary list wants", () => {
    expect(parseListTechstacks({}).sort).toBe("name");
  });
});
