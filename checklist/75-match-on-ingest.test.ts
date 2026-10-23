import { describe, expect, test } from "bun:test";
import { load, source } from "./helpers.ts";

// PASSING CRITERIA for Part A (SCRUM-75) — the wiring.
// Run with:   bun test checklist/75

describe("Part A checklist (SCRUM-75)", () => {
  test("step A5: toMatchUser reads a stored profile, with the same defaults as the wizard", async () => {
    const { toMatchUser } = await load("src/modules/match/match.service.ts");
    expect(toMatchUser, "export toMatchUser from match.service.ts").toBeFunction();
    const id = "650000000000000000000001";
    expect(
      toMatchUser({
        _id: id,
        profile: {
          budget_min: 100_000,
          tech_stacks: [{ tech_stack_id: { slug: "react" } }, { tech_stack_id: null }, { tech_stack_id: { slug: null } }],
        },
      }),
    ).toEqual({
      id,
      skills: ["react"],
      budgetMin: 100_000,
      budgetMax: null,
      // me.service getProfile defaults: on_match true, only_strong_fit true.
      notify: { onMatch: true, onlyStrongFit: true },
    });
  });

  test("step A6: notifyMatches writes pending, de-duplicated notifications", () => {
    const service = source("src/modules/match/match.service.ts");
    expect(service).toContain("export async function notifyMatches");
    expect(service).toContain("matchTorToUsers(");
    // The contract with Part B.
    expect(service).toContain('email_status: "pending"');
    // Idempotent: a second run on the same TOR adds nothing.
    expect(service).toContain("upsert: true");
    expect(service).toContain("$setOnInsert");
  });

  test("step A7: extraction runs matching, and a matching failure is logged, not thrown", () => {
    const extract = source("src/modules/extract/extract.service.ts");
    const at = extract.indexOf("notifyMatches(");
    expect(at, "call notifyMatches(row.torId) after tagTorSkills").toBeGreaterThan(extract.indexOf("tagTorSkills(row.torId)"));
    const around = extract.slice(Math.max(0, at - 200), at + 400);
    expect(around).toContain("try");
    expect(around).toContain("catch");
    expect(around).toContain("recordError");
  });

  test("step A8: a reader's own feed — GET /api/me/notifications, PATCH …/:id/read", async () => {
    const { meRouter } = await load("src/modules/me/me.route.ts");
    const routes = meRouter.stack
      .filter((l: { route?: unknown }) => l.route)
      .map((l: { route: { path: string; methods: Record<string, boolean> } }) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
    expect(routes).toContain("get /notifications");
    expect(routes).toContain("patch /notifications/:id/read");
  });

  test("step A8: both queries are scoped to the signed-in user (NFR-08)", () => {
    const service = source("src/modules/notification/notification.service.ts");
    for (const fn of ["listMyNotifications", "markMyNotificationRead"]) {
      const at = service.indexOf(`export async function ${fn}(userId`);
      expect(at, `export async function ${fn}(userId: string, …)`).toBeGreaterThan(-1);
      expect(service.slice(at, at + 600)).toMatch(/user_id:\s*userId/);
    }
  });

  test("step A9: the open GET /api/notification is locked to admins", async () => {
    const { notificationRouter } = await load("src/modules/notification/notification.route.ts");
    const { requireAdminToken } = await load("src/middleware/adminToken.ts");
    for (const layer of notificationRouter.stack.filter((l: { route?: unknown }) => l.route)) {
      const handlers = layer.route.stack.map((s: { handle: unknown }) => s.handle);
      expect(handlers, `${Object.keys(layer.route.methods)} ${layer.route.path} needs requireAdminToken`).toContain(requireAdminToken);
    }
  });
});
