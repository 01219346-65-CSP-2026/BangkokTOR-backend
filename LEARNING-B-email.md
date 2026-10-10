# Part B: match emails (SCRUM-77)

> Read [`LEARNING.md`](LEARNING.md) first: the flow, the contract with Part A, and which files are yours.
> Your branch: `feat/SCRUM-77/email-notification`, off `feat/SCRUM-75-77/match-and-email`.

## Your job

Part A writes notifications with `email_status: "pending"`. You build the worker that, every minute, collects them, sends **one digest email per reader** (not one per TOR), and records what happened to each row: `sent`, `failed` (with the reason) or `skipped`.

You don't need Part A to be finished. Your tests use hand-made data, and for a manual run you can insert a pending notification in Compass.

**Done when:** `bun test src/lib/mail src/modules/notification/notification.email.test.ts checklist/77` is green (20 tests), `bun test` is green, and `bun run typecheck` is clean. Right now all 20 are red.

## Design in one paragraph

Same shape as the AI code in `lib/ai`: a **port** (`Mailer`, with one `send(message)` method) and two implementations. `createResendMailer` POSTs to Resend's HTTP API with a plain `fetch` (no SDK, like `callGemini`). `createConsoleMailer` just prints, so the worker runs on any laptop with no key and sends nothing by accident. What the email **says** is a pure function (`buildMatchDigest`), tested without a network. The worker glues them together.

---

## Steps

### B1: the two mailers

**File:** `src/lib/mail/mailer.ts`. The types and `RESEND_URL` are given.

- `createResendMailer(apiKey, from)`: one `POST` to `RESEND_URL`. The key goes in the `Authorization: Bearer …` **header** and never in the body. The body is `{ from, to: [message.to], subject, text, html }`, where `to` is an **array**. If the response isn't ok, throw an `Error` whose message includes the status.
- `createConsoleMailer(log)`: calls `log` once with the recipient, subject and text. No `fetch`.

The tests swap `fetch` for a fake (read how: it's the same trick as `src/lib/ai/vertex.test.ts`), so they never reach Resend.

✅ `bun test src/lib/mail` (5 tests)

### B2: the small helpers

**File:** `src/modules/notification/notification.email.ts`.

- `escapeHtml`: a TOR title is text from a government portal, and it goes into HTML. Replace `&` **first**; the test shows why if you don't.
- `torLink(appUrl, torId)`: one slash between them, whatever `appUrl` ends with, and the id `encodeURIComponent`-ed.
- `groupByUser(rows)`: a `Map` from user id to their rows. A `Map` keeps insertion order, which the test relies on.
- `shouldEmail(recipient)`: needs a non-empty email, and `onMatch` mustn't be `false`. `null` means never chose, and the wizard's default is on. A `null` recipient (deleted since matching) gets `false`.

✅ `bun test src/modules/notification/notification.email.test.ts -t "B2"` (4 tests)

### B3: `buildMatchDigest`

Same file. The email itself, in Thai, as `{ to, subject, text, html }`:

- best fit first; at most `MAX_DIGEST_ITEMS` (10) listed, then *"และอีก N รายการ"* linking to `/notifications`;
- subject: one TOR shows its title (cut to 80 characters); several shows the count;
- body: greeting (with the name if there is one), each TOR's title, fit %, and link;
- **every** email links to `/skills`, where notifications can be turned off. An email people can't stop is spam;
- in the HTML, **everything** goes through `escapeHtml`: titles, the name, URLs. A test puts an `<img onerror=…>` in a title.
- FR-19: no grade, no signal.

Write `text` first and get those tests green, then `html`.

✅ `bun test src/modules/notification/notification.email.test.ts` is fully green.

### B4: settings and `createMailer`

- `src/config/env.ts`: add `resendApiKey` (`RESEND_API_KEY`, default `""`), `mailFrom` (`MAIL_FROM`, default `"BangkokTOR <onboarding@resend.dev>"`), `appUrl` (`APP_URL`, default `"http://localhost:3003"`, the frontend that links point to), `emailIntervalMs` (`EMAIL_INTERVAL_MS`, 60000) and `emailBatchSize` (`EMAIL_BATCH_SIZE`, 200). Use `Number(...)` for the two numbers.
- `.env.example`: all five, with `RESEND_API_KEY=` **empty** and a comment saying empty means "print to the console".
- `mailer.ts` → `createMailer()`: Resend when there's a key, the console otherwise.

✅ `bun test checklist/77 -t "B4"` (2 tests)

### B5: `sendPendingEmails`

**Create:** `src/modules/notification/email.service.ts`

```ts
export async function sendPendingEmails(mailer: Mailer = createMailer(), limit = env.emailBatchSize)
  : Promise<{ sent: number; failed: number; skipped: number }>
```

1. Find up to `limit` notifications with `email_status: "pending"`, oldest first, `.lean()`.
2. Turn them into `PendingRow`s and `groupByUser`.
3. Load those users in **one** query (`_id: { $in: [...] }`), only `email`, `name` and `profile.notify.on_match`.
4. For each user's group:
   - `!shouldEmail(...)` → `updateMany` those rows to `"skipped"`;
   - otherwise, in a `try`: `mailer.send(buildMatchDigest(...))`, then mark them `"sent"` with `emailed_at: new Date()`;
   - `catch`: mark them `"failed"` with `email_error` (cut to 500 characters). **Keep going**: one bad address mustn't stop everyone else's email.
5. Return the counts (rows, not emails).

Taking `mailer` as a parameter is what makes this testable later (pass a fake) and lets the worker log which mailer ran.

✅ `bun test checklist/77 -t "B5"`

### B6: the worker

- **Create:** `src/email-worker.ts`: `connectMongo()`, `createMailer()`, log which mailer it is, then loop `sendPendingEmails(mailer)` → log the counts if any → sleep `env.emailIntervalMs`. Stop cleanly on `SIGINT`/`SIGTERM` (set a flag, finish the current run, `disconnectMongo()`). `src/grade-worker.ts` shows the pattern; you don't need its heartbeat.
- `package.json`: `"email-worker": "bun run src/email-worker.ts"`.

Run exactly **one** worker. Two would read the same pending rows and send every email twice.

✅ `bun test checklist/77` is fully green.

---

## Try it (no Part A needed)

1. In Compass, add a document to `notifications`: your user's `_id` as `user_id`, any TOR's `_id` as `tor_id`, a `title`, `fit_score: 80`, `email_status: "pending"`, `created_at: new Date()`.
2. `bun run email-worker` with no key: the console prints the email.
3. The row is now `sent`. Insert another for a user with no email → `skipped`.
4. Set `RESEND_API_KEY` (free tier) and send one real email to yourself. Until you verify a domain with Resend, it only delivers to your own Resend account's address. That's why `MAIL_FROM` defaults to `onboarding@resend.dev`.

## Stretch (not covered by tests)

- **Retry `failed`**, but not forever: add an attempt count and give up after 3.
- **Heartbeat.** Register the worker with `modules/monitor` like the grade worker, so the admin pipeline page shows it. That touches the admin UI's worker kinds too.
- **Claim before send**, so two workers could run safely: move rows to a `sending` state first (`findOneAndUpdate`), like `claim.ts` in ingest.

## Using AI to help (without having it write the code for you)

- *"Here's my `buildMatchDigest` and the failing XSS test. What am I not escaping? Don't fix it."*
- *"Why does `escapeHtml` have to replace `&` before `<`? Tiny example."*
- *"Review my `sendPendingEmails`: can one failure stop the loop? Point to the line."*
