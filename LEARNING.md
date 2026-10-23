# feat/SCRUM-75-77: match notifications + email (two people, two guides)

> **You write the code on this branch.** The tests are the spec. This branch is built for **two people working at the same time**:
>
> | Part | Jira | Guide | One-line job |
> |---|---|---|---|
> | **A: ingest** | SCRUM-75 | [`LEARNING-A-ingest.md`](LEARNING-A-ingest.md) | when a new TOR is ingested, find the readers it fits and write their notifications |
> | **B: email** | SCRUM-77 | [`LEARNING-B-email.md`](LEARNING-B-email.md) | turn waiting notifications into one email per reader |
>
> Read this page together first (10 minutes), then split up.
>
> Setup and syntax help: [`docs/learning/`](docs/learning/README.md).

---

## The whole flow, and where you split

```
 e-GP / BMA ─▶ ingest ─▶ extract ─▶ tagTorSkills(tor)
                                      │
                         ┌────────────┴─ PART A ──────────────────────────┐
                         │ notifyMatches(tor)                              │
                         │   matchTorToUsers(tor, readers)   (pure)        │
                         │   → notifications { fit_score,                  │
                         │                     email_status: "pending" }   │
                         └────────────┬────────────────────────────────────┘
                                      │      MongoDB: notifications
                         ┌────────────┴─ PART B ──────────────────────────┐
                         │ email-worker, every minute:                     │
                         │   sendPendingEmails()                           │
                         │     groupByUser → buildMatchDigest  (pure)      │
                         │     → Mailer.send (Resend, or console in dev)   │
                         │     → email_status "sent" / "failed" / "skipped"│
                         └─────────────────────────────────────────────────┘
```

### The contract (already written; don't change it alone)

`src/modules/notification/notification.model.ts` has four new fields, and they are the **only** thing the two parts share:

| Field | Written by | Meaning |
|---|---|---|
| `fit_score` | A | 0–100, how well the reader's skills fit |
| `email_status` | A sets `"pending"`, B moves it on | `pending` → `sent` / `failed` / `skipped` (default `skipped`: only matching asks for email) |
| `emailed_at` | B | when it was sent |
| `email_error` | B | why it failed (admin only) |

There's also a unique index on `(user_id, tor_id)`, so one TOR can never notify the same reader twice.

**Because of the contract, neither of you waits for the other.** B's tests use hand-made pending rows; A's tests never send an email. You only meet at the end-to-end check (below).

### Who owns which files (so your merges don't conflict)

| Part A only | Part B only |
|---|---|
| `src/modules/match/*` | `src/lib/mail/*` |
| `src/modules/extract/extract.service.ts` (one call) | `src/modules/notification/notification.email.ts` |
| `src/modules/me/me.route.ts`, `me.controller.ts` | `src/modules/notification/email.service.ts` (new) |
| `src/modules/notification/notification.service.ts` | `src/email-worker.ts` (new) |
| `src/modules/notification/notification.route.ts` | `src/config/env.ts`, `.env.example`, `package.json` |

If you need to touch the other person's file, tell them first.

### How to branch

Don't both push to this branch. Each of you branches off it, using the names already in the project plan:

```sh
git switch feat/SCRUM-75-77/match-and-email
git switch -c feat/SCRUM-75/auto-match-notifications   # person A
git switch -c feat/SCRUM-77/email-notification         # person B
```

Open each PR **into `feat/SCRUM-75-77/match-and-email`**. When both are merged, run the end-to-end check, then open one PR from it into `main`.

---

## Passing criteria

| # | Check | Command |
|---|---|---|
| A | Part A green (18 tests) | `bun test src/modules/match checklist/75` |
| B | Part B green (20 tests) | `bun test src/lib/mail src/modules/notification/notification.email.test.ts checklist/77` |
| 1 | **Every** test green | `bun test` |
| 2 | TypeScript happy | `bun run typecheck` |
| 3 | End to end, together | below |

### End-to-end check (do this together, after both PRs are in)

With Mongo running and **no** `RESEND_API_KEY` (so emails print instead of sending):

1. Sign in on the frontend and save a skill profile (`/skills`) with skills that a real open TOR needs.
2. `bun run extract-worker` and let one TOR through (or call `notifyMatches(<torId>)` from a scratch script).
3. In Compass, `notifications` has a row for you with `email_status: "pending"` and a `fit_score`.
4. `bun run email-worker`: the console prints one email to your address, with a link to the TOR.
5. The row is now `email_status: "sent"` with `emailed_at`. Run the worker again: nothing is sent twice.
6. Turn "notify on match" off in your profile, repeat with another TOR: no notification at all (A's rule), and any row still pending ends up `skipped` (B's rule).

Then set a real `RESEND_API_KEY` and send yourself one real email.

---

## FR-19 applies to both halves

A notification and an email are both text **about a named government agency's tender**, sent to a third party. Say what matched (skills, numbers) and link to the TOR. Never mention a grade, a signal or "suspicious", and never advise. Both test suites check this.
