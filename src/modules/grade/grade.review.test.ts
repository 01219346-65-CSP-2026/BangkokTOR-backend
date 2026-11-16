import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Types } from "mongoose";
import { TorModel } from "../tor/tor.model.ts";
import { countSignals, listPendingReviews, resolveReview } from "./grade.service.ts";

// T16: the absence-review queue, with TorModel stubbed — no database.

const TOR_ID = new Types.ObjectId();
const legit = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  fired: false,
  weight: 0,
  phase: "legitimacy",
  evidence: "",
  checked: true,
  filename: null,
  needsReview: false,
  ...extra,
});
const fair = (code: string) => ({ ...legit(code), phase: "fairness" });

/** A clean TOR whose only issue is a held NOENTITY absence. */
function stored() {
  return [
    legit("IDMISMATCH"),
    legit("BUDGETMISMATCH"),
    legit("NOENTITY", { fired: true, evidence: "ABSENCE", needsReview: true }),
    legit("CHANNEL"),
    legit("REPUTATION", { checked: false }),
    fair("PENALTY"),
    fair("HOURS"),
  ];
}

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => {
  while (spies.length) spies.pop()!.mockRestore();
});

function stubTor(ruleFindings: unknown[] | null, modifiedCount = 1) {
  const writes: unknown[] = [];
  spies.push(
    spyOn(TorModel, "findById").mockImplementation((() => ({
      select: () => ({ lean: async () => (ruleFindings ? { _id: TOR_ID, ruleFindings } : null) }),
    })) as never),
    spyOn(TorModel, "updateOne").mockImplementation((async (filter: unknown, update: unknown) => {
      writes.push({ filter, update });
      return { modifiedCount };
    }) as never),
  );
  return writes;
}

describe("resolveReview", () => {
  test("confirm: the finding now counts, and the grade is re-scored", async () => {
    const writes = stubTor(stored());
    const out = await resolveReview(String(TOR_ID), "NOENTITY", "confirm");

    expect(out).toMatchObject({ ok: true, signalCount: 1, regradeQueued: false });
    const { filter, update } = writes[0] as { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } };
    // Guarded: only applies while the finding is still held.
    expect(filter.ruleFindings).toEqual({ $elemMatch: { code: "NOENTITY", needsReview: true } });
    const findings = update.$set.ruleFindings as Array<Record<string, unknown>>;
    expect(findings.find((f) => f.code === "NOENTITY")).toMatchObject({ fired: true, needsReview: false });
    expect(update.$set.signalCount).toBe(1);
  });

  test("reject: checked, not fired, evidence cleared", async () => {
    const writes = stubTor(stored());
    const out = await resolveReview(String(TOR_ID), "NOENTITY", "reject");

    expect(out).toMatchObject({ ok: true, grade: "A", signalCount: 0 });
    const findings = (writes[0] as { update: { $set: { ruleFindings: Array<Record<string, unknown>> } } }).update.$set
      .ruleFindings;
    expect(findings.find((f) => f.code === "NOENTITY")).toMatchObject({
      fired: false,
      evidence: "",
      checked: true,
      needsReview: false,
    });
  });

  test("a reject that lifts legitimacy to a pass with no fairness findings queues a regrade", async () => {
    // Before: IDMISMATCH(4) fired of 8 checked weight = 50%, a fail, so
    // fairness was never asked. Rejecting NOENTITY adds 3 checked, not fired:
    // (11 - 4) / 11 = 63.6%, a pass — with no fairness findings behind it.
    const findings = [
      legit("IDMISMATCH", { fired: true, evidence: "ABSENCE" }),
      legit("BUDGETMISMATCH"),
      legit("NOENTITY", { fired: true, evidence: "ABSENCE", needsReview: true }),
      legit("CHANNEL", { checked: false }),
      legit("REPUTATION", { checked: false }),
    ];
    const writes = stubTor(findings);
    const out = await resolveReview(String(TOR_ID), "NOENTITY", "reject");

    expect(out).toMatchObject({ ok: true, regradeQueued: true });
    expect((writes[0] as { update: { $set: Record<string, unknown> } }).update.$set.graderVersion).toBeNull();
  });

  test("unknown TOR, bad id, or nothing held → not applied", async () => {
    stubTor(null);
    expect(await resolveReview(String(TOR_ID), "NOENTITY", "confirm")).toEqual({ ok: false, reason: "not-found" });
    expect(await resolveReview("not-an-id", "NOENTITY", "confirm")).toEqual({ ok: false, reason: "not-found" });
  });

  test("a finding that is not held cannot be resolved", async () => {
    stubTor(stored());
    expect(await resolveReview(String(TOR_ID), "CHANNEL", "confirm")).toEqual({ ok: false, reason: "not-pending" });
  });

  test("a concurrent resolve that lost the race reports not-pending", async () => {
    stubTor(stored(), 0);
    expect(await resolveReview(String(TOR_ID), "NOENTITY", "confirm")).toEqual({ ok: false, reason: "not-pending" });
  });
});

describe("listPendingReviews", () => {
  test("lists held codes per TOR, oldest first, limit clamped", async () => {
    let query: { filter?: unknown; sort?: unknown; limit?: number } = {};
    spies.push(
      spyOn(TorModel, "find").mockImplementation(((filter: unknown) => {
        query.filter = filter;
        const chain = {
          select: () => chain,
          sort: (s: unknown) => ((query.sort = s), chain),
          limit: (n: number) => ((query.limit = n), chain),
          lean: async () => [
            { _id: TOR_ID, projectId: "p1", projectName: "n", agency: "a", ruleFindings: stored(), gradedAt: null },
          ],
        };
        return chain;
      }) as never),
    );

    const items = await listPendingReviews(10_000);
    expect(query.filter).toEqual({ "ruleFindings.needsReview": true });
    expect(query.sort).toEqual({ gradedAt: 1 });
    expect(query.limit).toBe(200);
    expect(items).toEqual([
      { torId: String(TOR_ID), projectId: "p1", projectName: "n", agency: "a", codes: ["NOENTITY"], gradedAt: null },
    ]);
  });
});

describe("countSignals", () => {
  test("counts fired findings that are not held", () => {
    expect(
      countSignals([
        { fired: true },
        { fired: true, needsReview: true },
        { fired: false },
        { fired: true, needsReview: false },
      ]),
    ).toBe(2);
  });
});
