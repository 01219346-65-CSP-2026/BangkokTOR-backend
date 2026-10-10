# feat/116: graph dashboard (backend: the insights API)

> **You write the code on this branch.** This file tells you what to build, in which order, and how you know you're done. The tests are the spec. When they're all green, the branch is finished.
>
> Jira: **SCRUM-116 Implement Graph Dashboard**. This is the backend half; the frontend half is `feat/SCRUM-116/graph-dashboard` in the frontend repo, with its own `LEARNING.md`. Do this one first, because it defines the JSON the frontend draws.
>
> Setup and syntax help: [`docs/learning/`](docs/learning/README.md).

---

## Why this branch exists

The customer saw two slides of TOR numbers and liked them:

| Slide | What it said |
|---|---|
| **TOR Data** | 4,557 software TORs · 77 provinces · 55% from Bangkok · 18 open for bids |
| **Method split** | Direct award is 75% of TORs but 19% of the money; e-bidding is 17% of TORs but 59% of the money. *"Biddable tenders are fewer but larger."* |

He wants that as a **live dashboard**, with more graphs. The dashboard page already has four empty chart panels waiting (`placeholderTitle: "Not built yet"` in the frontend). This branch builds the one endpoint that feeds all four:

```
GET /api/tors/insights                       → all of Thailand
GET /api/tors/insights?province=กรุงเทพมหานคร → Bangkok only
```

### The four graphs (and why these four)

Each one answers a question a software team asks before bidding:

| # | Question | Graph | Field in the response |
|---|---|---|---|
| — | *How big is the market?* | 4 headline numbers (the slide he liked) | `totals` |
| 1 | *What kind of tender is it?* (the Jira's graph 1) | two 100% bars: share **by number** vs share **by budget** | `byMethod` |
| 2 | *How big are the contracts?* | columns per budget band, biddable part dark | `budgetBands` |
| 3 | *Who is buying?* | ranked bars, top 8 agencies by **biddable** budget | `topAgencies` |
| 4 | *When do tenders come out?* | columns per month, last 12 months | `byMonth` |

"Biddable" means **e-bidding or selection** (`methodId` `eBidding` / `competitive`). A direct award (`specific`, เฉพาะเจาะจง) never publishes an invitation, so an outside team can't bid on it. `tor.bidding.ts` has the same rule.

### The rule you must not break: FR-19

These are **market numbers**: how many, how much, where, when. The response must never carry a grade, a rule finding or a signal, and must never rank a named agency by anything but what it spends. "Agencies with the most red flags" is exactly the accusatory shape `AGENTS.md` §1 forbids. A test checks this.

## The flow you're building

```
GET /api/tors/insights?province=…
  │ tor.route.ts        torRouter.get("/insights", …)   ★ step 9 (BEFORE "/:id")
  ▼
  │ tor.controller.ts   insights(req, res)               ★ step 9
  ▼
  │ tor.validation.ts   parseInsightsQuery(req.query)    ★ step 7  → { province? }
  ▼
  │ tor.service.ts      getInsights(input)               ★ step 8
  │    TorModel.find(publicScope + province, 7 fields).lean()
  ▼
  │ tor.insights.ts     buildInsights(rows, now)         ★ steps 1–6  (pure: no database)
  ▼
JSON
```

The shape is the same as the `/skills` preview (`tor.preview.ts`): **load a few thousand small rows once, do the maths in a pure function.** That function can be tested with plain arrays, with no Mongo needed. Read `tor.preview.ts` and its test once before you start.

> **Why not a Mongo aggregation?** You could compute each graph with `$group`, as `getStats()` does. But that's six pipelines, and each one is only testable against a real database. The public scope is a few thousand rows of seven small fields, which is cheap to load. If the corpus grows 100×, move the heavy parts into `$group`; the tests still describe the answer.

### Scope: why the numbers won't match the slide exactly

`getInsights` goes through `publicScope()`, the same filter as the listings page: software TORs from **this fiscal year and last**. The slide counted the whole corpus. Using the same scope as the listings means the dashboard and the list never disagree. (A stretch goal adds an "all years" option.)

---

## Passing criteria (the branch is done when ALL of these are true)

| # | Check | Command |
|---|---|---|
| 1 | The insights maths is green | `bun test src/modules/tor/tor.insights.test.ts` |
| 2 | The wiring checklist is green | `bun test checklist/116` |
| 3 | **Every** test in the repo is green | `bun test` |
| 4 | TypeScript is happy | `bun run typecheck` |
| 5 | It answers over HTTP | the `curl` checks in step 10 |

Right now 1 and 2 fail on purpose (22 red). Work through the steps and watch them turn green.

---

## Steps

### Step 1: the helpers

**File:** `src/modules/tor/tor.insights.ts`. The types and constants are given. Write `share`, `budgetBand`, `monthKey`, `lastMonths`.

- `share(1, 3)` is `33.3`: a percent with **one decimal**.
- `budgetBand`: lower bound inclusive, upper exclusive. `500_000` is `"500kTo5m"`.
- `monthKey` must read the month **in Bangkok time**. `2026-01-31T20:00Z` is already February in Bangkok. `thaiFiscalYear()` in `tor.service.ts` uses the same "shift by +7h, then read UTC" trick.
- `lastMonths(now)` is the 12 keys ending with now's month. `Date.UTC(2026, -1, 1)` is 1 December 2025, so let `Date` do the year wrap for you.

✅ `bun test src/modules/tor/tor.insights.test.ts` → "step 1" (4 tests).

### Step 2: `buildInsights` → `totals`

Write `isBiddable`, then start `buildInsights`. Return the whole `InsightsJSON` shape from the start, with placeholder values (`[]`, `0`) for the graphs you haven't reached yet, so TypeScript stays happy and the earlier tests can go green.

- `budget` sums use `row.budget ?? 0`: a TOR with no budget still counts as a TOR.
- `provinces`: distinct, **non-empty** provinces. `new Set(...)` plus `.filter(Boolean)`.
- `openNow`: don't re-invent the rule. Import `biddingStatus` from `tor.bidding.ts` and count `=== "open"`.
- No rows at all must not crash, and must not divide by zero.

✅ "step 2" (5 tests).

### Step 3: graph 1, `byMethod`

One slice per method, **in the order** `specific → eBidding → competitive`, each with `tors`, `budget`, `torShare`, `budgetShare`. A method with no TORs still appears at zero. `null` or unrecognised methods go into an `"unknown"` slice, listed last and **only if it has any TORs**.

Hint: a `Map` pre-filled with every method at `{ tors: 0, budget: 0 }` keeps the order and the zeros for free.

✅ "step 3" (3 tests).

### Step 4: graph 2, `budgetBands` + `unpricedTors`

Every band in `BUDGET_BANDS` order, each with `tors` and how many are `biddable`. A `null` budget goes into `unpricedTors`, not into a band.

✅ "step 4".

### Step 5: graph 3, `topAgencies`

Biddable TORs only. Group by agency, sum `tors` and `budget`, sort by budget (most first), then by count, then by name. Keep the top `TOP_AGENCIES` (8). Skip blank agencies.

Chained tie-breakers in one comparator: `b.budget - a.budget || b.tors - a.tors || …`. This works because `0` is falsy.

✅ "step 5" (3 tests).

### Step 6: graph 4, `byMonth`

The 12 months from `lastMonths(now)`, zero-filled, oldest first, counting `tors` and `biddable` by `monthKey(announcedAt)`. Rows outside the window, or with no `announcedAt`, are ignored.

✅ "step 6" and the "FR-19" test. The whole of `tor.insights.test.ts` is green.

### Step 7: `parseInsightsQuery`

**File:** `src/modules/tor/tor.validation.ts`. Look at `parsePreviewQuery` for the pattern.

- Export `parseInsightsQuery(query: Record<string, unknown>): InsightsInput`.
- `province`: trimmed string. Blank, not a string (Express gives an **array** for `?province=a&province=b`), or longer than 64 characters → `undefined`.
- Define `export type InsightsInput = { province?: string }` in `tor.service.ts`, next to `ListInput`, and import it here the way `ListInput` is imported.

✅ `bun test checklist/116` → "step 7".

### Step 8: `getInsights` in the service

**File:** `src/modules/tor/tor.service.ts`. Model it on `previewForProfile`.

1. `const filter = publicScope(now)`; if `input.province`, add `filter.province = input.province`.
2. `TorModel.find(filter, { _id: 0, methodId: 1, budget: 1, province: 1, agency: 1, announcedAt: 1, biddingStage: 1, bidClosesAt: 1 }).lean<InsightRow[]>()`.
   **Project only those fields.** A full TOR row carries `ruleFindings` and `grade`. Never loading them is the strongest FR-19 guarantee there is, and the checklist looks for it.
3. Return `{ fiscalYear: thaiFiscalYear(now), province: input.province ?? null, ...buildInsights(rows, now) }`.

✅ "step 8".

### Step 9: controller + route

- `tor.controller.ts`: `export async function insights(req, res)`, which is `res.json(await service.getInsights(parseInsightsQuery(req.query as Record<string, unknown>)))`. Copy `preview`.
- `tor.route.ts`: `torRouter.get("/insights", controller.insights)`, placed **above** `"/:id"`. Read the comment at the top of that file to see why: Express matches routes in order, so `"/:id"` would catch `insights` as an id and answer 404.

✅ `bun test checklist/116` is fully green. `bun test` is fully green. `bun run typecheck` is clean.

### Step 10: try it over HTTP

```sh
bun run dev    # tab 1
curl -s localhost:8003/api/tors/insights | jq '.totals, .byMethod'
curl -s "localhost:8003/api/tors/insights?province=$(jq -rn '"กรุงเทพมหานคร"|@uri')" | jq .totals
curl -s localhost:8003/api/tors/insights | grep -ciE 'grade|signal'   # must print 0
```

- [ ] `totals.tors` equals `GET /api/tors/stats` → `total` (same scope, so the same number)
- [ ] `byMethod` shares each add up to ~100
- [ ] the Bangkok call's `bangkokShare` is `100` (or `0` when there are no rows)
- [ ] `byMonth` has 12 entries, the last one being this month

---

## Stretch (not covered by tests)

- **All years.** Add `?years=all` to drop the fiscal-year half of `publicScope` (keep software-only and the status gate). That makes the slide's 4,557 reproducible. Write the validation test first.
- **Cache it.** The numbers change when a worker finishes, not per request. A 5-minute in-memory cache keyed by `province` stops every dashboard view from re-reading thousands of rows.
- **Closing soon.** A fifth graph: open TORs by days until `bidClosesAt` (≤7, 8–14, 15–30). It's the most "act now" number for a bidder.

---

## Using AI to help (without having it write the code for you)

Write your attempt first. When you're stuck, paste your code and **the failing test output** and ask for a *hint*:

- *"Here's my `buildInsights` and the failing step 3 test. Don't fix it. Which case am I not handling?"*
- *"Why does `new Date(Date.UTC(2026, -1, 1))` give December 2025? Tiny example, not my code."*
- *"My sort comparator gives the wrong order on ties. Point to the line, don't rewrite it."*
- *"Explain why `torRouter.get('/:id')` above `/insights` makes `/insights` 404."*

When all five passing criteria hold, commit, push, and open a PR into `main`. Then do the frontend half.
