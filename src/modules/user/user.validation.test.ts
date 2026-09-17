import { describe, expect, test } from "bun:test";
import { HttpError } from "../../middleware/errors.ts";
import { parseCreateUser, parseListUsers, parseUpdateUser } from "./user.validation.ts";

// These tests exist because the bug they cover was real: the services used to
// spread req.body straight into $set, so PATCH {"role":"admin"} wrote. The
// parse layer IS the authorisation boundary for that field, so it gets tests
// before anything else here does.

function status(fn: () => unknown): number | string {
  try {
    fn();
    return "no throw";
  } catch (err) {
    return err instanceof HttpError ? err.status : "wrong error type";
  }
}

describe("parseUpdateUser — privilege escalation", () => {
  test("rejects a role change outright", () => {
    expect(status(() => parseUpdateUser({ role: "admin" }))).toBe(400);
  });

  test("rejects role even alongside a legitimate field", () => {
    // The dangerous shape: a valid-looking edit that smuggles the role in.
    expect(status(() => parseUpdateUser({ email: "a@b.com", role: "admin" }))).toBe(400);
  });

  test("role never survives into the returned object", () => {
    const out = parseUpdateUser({ email: "a@b.com" }) as Record<string, unknown>;
    expect("role" in out).toBe(false);
  });

  test("unknown keys are dropped, not passed through to $set", () => {
    const out = parseUpdateUser({
      email: "a@b.com",
      isAdmin: true,
      __proto__: { polluted: true },
      created_at: "1999-01-01",
    }) as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(["email"]);
  });
});

describe("parseUpdateUser — general", () => {
  test("requires at least one field", () => {
    expect(status(() => parseUpdateUser({}))).toBe(400);
  });

  test("rejects a non-object body", () => {
    for (const body of ["string", 42, null, [], undefined]) {
      expect(status(() => parseUpdateUser(body))).toBe(400);
    }
  });

  test("normalises email case", () => {
    expect(parseUpdateUser({ email: "  Mixed@Case.COM " }).email).toBe("mixed@case.com");
  });

  test("rejects an obviously invalid email", () => {
    for (const email of ["notanemail", "no@tld", "@nolocal.com", "two@@at.com"]) {
      expect(status(() => parseUpdateUser({ email }))).toBe(400);
    }
  });
});

describe("parseCreateUser", () => {
  test("requires an email", () => {
    expect(status(() => parseCreateUser({ google_id: "g1" }))).toBe(400);
  });

  test("accepts a minimal valid body", () => {
    expect(parseCreateUser({ email: "a@b.com" })).toEqual({ email: "a@b.com" });
  });

  test("cannot set a role at creation either", () => {
    const out = parseCreateUser({ email: "a@b.com", role: "admin" }) as Record<string, unknown>;
    expect("role" in out).toBe(false);
  });

  test("validates the nested profile", () => {
    const out = parseCreateUser({
      email: "a@b.com",
      profile: { description: "we build things", budget_min: 1000, budget_max: 9000, team_size: 4 },
    });
    expect(out.profile).toMatchObject({ budget_min: 1000, budget_max: 9000, team_size: 4 });
  });

  test("rejects an inverted budget range", () => {
    expect(
      status(() => parseCreateUser({ email: "a@b.com", profile: { budget_min: 9000, budget_max: 1000 } })),
    ).toBe(400);
  });

  test("rejects a negative budget and a zero team", () => {
    expect(status(() => parseCreateUser({ email: "a@b.com", profile: { budget_min: -1 } }))).toBe(400);
    expect(status(() => parseCreateUser({ email: "a@b.com", profile: { team_size: 0 } }))).toBe(400);
  });

  test("rejects a tech_stack_id that is not an ObjectId", () => {
    expect(
      status(() =>
        parseCreateUser({ email: "a@b.com", profile: { tech_stacks: [{ tech_stack_id: "nope" }] } }),
      ),
    ).toBe(400);
  });

  test("accepts a valid tech stack reference", () => {
    const id = "6aa51ee3c3f15ca4cda033df";
    const out = parseCreateUser({
      email: "a@b.com",
      profile: { tech_stacks: [{ tech_stack_id: id, years_experience: 3 }] },
    });
    expect(out.profile?.tech_stacks).toEqual([{ tech_stack_id: id, years_experience: 3 }]);
  });
});

describe("parseListUsers", () => {
  test("whitelists sort — an arbitrary value never reaches Mongoose", () => {
    // The old code passed req.query.sort straight to .sort(), so this threw a
    // raw driver error as a 500.
    expect(status(() => parseListUsers({ sort: "; drop" }))).toBe(400);
    expect(status(() => parseListUsers({ sort: { $ne: null } }))).toBe(400);
  });

  test("accepts the documented sort fields", () => {
    for (const sort of ["created_at", "-created_at", "email", "-email"] as const) {
      expect(parseListUsers({ sort }).sort).toBe(sort);
    }
  });

  test("defaults and clamps paging", () => {
    expect(parseListUsers({})).toMatchObject({ page: 1, limit: 20, sort: "-created_at" });
    expect(parseListUsers({ limit: "9999" }).limit).toBe(100);
    expect(parseListUsers({ page: "-5" }).page).toBe(1);
    expect(parseListUsers({ page: "abc" }).page).toBe(1);
  });

  test("rejects an unknown role filter", () => {
    expect(status(() => parseListUsers({ role: "superuser" }))).toBe(400);
    expect(parseListUsers({ role: "agency" }).role).toBe("agency");
  });
});
