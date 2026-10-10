# Part A: match on ingest (SCRUM-75)

> Read [`LEARNING.md`](LEARNING.md) first: the flow, the contract with Part B, and which files are yours.
> Your branch: `feat/SCRUM-75/auto-match-notifications`, off `feat/SCRUM-75-77/match-and-email`.

## Your job

When the pipeline finishes extracting a TOR and tags its skills, find every reader whose skill profile fits it, and write one notification each with `email_status: "pending"`. Part B emails those. You also give readers a safe way to read their own notifications, and close an API hole that exposes everyone else's.

**Done when:** `bun test src/modules/match checklist/75` is green (18 tests), `bun test` is green, and `bun run typecheck` is clean. Right now all 18 are red.

## The matching rule

A reader is notified about a TOR when **all** of these hold:

| # | Rule | Why |
|---|---|---|
| 1 | the TOR has at least one tagged skill | no skills means "can't tell", not "fits" |
| 2 | the TOR isn't `closed` (`biddingStatus` in `tor.bidding.ts`) | no point telling anyone about a tender they can't bid on |
| 3 | the reader hasn't turned "notify on match" off | their choice, from the `/skills` wizard |
| 4 | the TOR's budget is inside the reader's range (when the TOR has a budget) | same filter as the listing |
| 5 | fit ≥ 40, or ≥ 70 if the reader chose "only strong fit" | 40 is the `/tor` page's "moderate" line; 70 is "strong" |

**Fit** = the share of the TOR's required skills the reader has, 0–100, using `fitScore` from `tor.preview.ts` so it's the **same number** the listing shows. Don't write a second formula.

---

## Steps

### A1: `matchMessage`

**File:** `src/modules/match/match.ts`. The notification body: `ตรงกับทักษะของคุณ 3 จาก 4 รายการ (75%)`. Facts only.

✅ `bun test src/modules/match -t "A1"`

### A2–A4: `matchTorToUsers`

Same file. The types (`MatchTor`, `MatchUser`, `MatchResult`) are given; the TODO lists the rules in order. Do the TOR-level checks once, before the loop over users.

- A2: the fit rule and the sort (best fit first, ties by user id).
- A3: opted out; budget range (a `null` bound means no limit).
- A4: closed tenders. Import `biddingStatus`, don't re-derive it.

Watch out for duplicates: a profile listing `react` twice must still count it once. Count **distinct** matched skills.

✅ `bun test src/modules/match` is fully green (13 tests).

### A5: `toMatchUser`

**File:** `src/modules/match/match.service.ts`. Turn a stored user (with `tech_stacks` populated to their slugs) into a `MatchUser`. The notify defaults must match `getProfile` in `src/modules/me/me.service.ts`, `on_match: true, only_strong_fit: true`, or a reader who never touched the toggles would be matched differently from what the wizard shows them.

✅ `bun test checklist/75 -t "A5"`

### A6: `notifyMatches`

Same file. The TODO walks through it: load the TOR, load candidate readers (populate their skill slugs the way `getProfile` does), run your matcher, write the notifications.

The write must be **idempotent**: extraction can run twice on the same TOR (a retry, or a re-extract), and a reader must never get the same TOR twice. Use `bulkWrite` with `updateOne` + `upsert: true` + `$setOnInsert`. "Set on insert" means a second run finds the existing row and changes nothing. The unique `(user_id, tor_id)` index in the model is the backstop. Return `upsertedCount` (new rows only).

Set `email_status: "pending"` on insert. **That's the contract**: it's how Part B finds work.

✅ `bun test checklist/75 -t "A6"`

### A7: call it from extraction

**File:** `src/modules/extract/extract.service.ts`, right after `await tagTorSkills(row.torId)` (matching needs the tags).

Wrap it in `try/catch` and `recordError({ kind: "match-failed", … })` in the catch. A matching bug must cost the notifications, **never** the extraction, and must not fail silently (FR-06).

✅ `bun test checklist/75 -t "A7"`

### A8: a reader's own notifications

Today `GET /api/notification?user_id=…` returns **anyone's** notifications to **anyone**. That's an IDOR, which the SRS names explicitly (NFR-08). The fix is two routes where the user comes from the verified token, never from the URL:

- `src/modules/notification/notification.service.ts`: add `listMyNotifications(userId, limit = 50)` (newest first, limit clamped to 1–100) and `markMyNotificationRead(userId, id)`. **Both filter on `user_id: userId`.** Someone else's notification id answers 404, not 403, because a 403 would confirm the id exists.
- `src/modules/me/me.controller.ts` + `me.route.ts`: `GET /notifications` and `PATCH /notifications/:id/read`. `meRouter` already runs `requireUser`, which puts the id in `res.locals.userId`. Copy the bookmark handlers.

✅ `bun test checklist/75 -t "A8"` (2 tests)

### A9: lock the old routes

**File:** `src/modules/notification/notification.route.ts`. Put `requireAdminToken` on the two `GET`s as well. Afterwards, every route in that file needs it; the test checks each one. Nothing in the frontend calls these routes today, so nothing breaks.

✅ `bun test checklist/75` is fully green.

---

## Try it

```sh
bun run dev
# signed-in frontend → save a profile at /skills, then:
bun -e 'import {connectMongo} from "./src/db/mongo.ts"; import {notifyMatches} from "./src/modules/match/match.service.ts"; await connectMongo(); console.log(await notifyMatches("<an open TOR id>")); process.exit(0)'
```

Run it twice: the first run prints `1` (if you fit) and the second prints `0`. Check the row in Compass (`fit_score`, `email_status: "pending"`).

## Stretch (not covered by tests)

- **Backfill.** Readers who sign up today hear nothing about TORs already open. A small `src/backfill-matches.ts` that runs `notifyMatches` over every open TOR fixes that. Ask Part B first: it will produce a lot of emails at once.
- **Profile change.** When a reader saves new skills, match them against open TORs (same idea, one user).

## Using AI to help (without having it write the code for you)

- *"Here's my `matchTorToUsers` and the failing test. Which rule am I missing? Don't write the fix."*
- *"What does `$setOnInsert` do in a Mongo upsert? Tiny example, not my code."*
- *"Why is returning 404 instead of 403 for someone else's notification safer?"*
