# feat/92: TOR AI summary (three topics, whole text, one Vertex call)

> **You write the code on this branch.** The tests are the spec. When they're all green, the branch is done.
>
> Jira: **SCRUM-92 Implement Vertex AI TOR summary** (FR-10). This is the backend half. The frontend half, `feat/92/tor-ai-summary` in the frontend repo, draws the three cards and has its own `LEARNING.md`.
>
> **Already done for you:** branch 91 (`callGemini`, the Vertex grader) and `main` are merged in, so this branch is up to date and starts from your finished 91 code.
>
> Setup and syntax help: [`docs/learning/`](docs/learning/README.md).

---

## Why this branch exists

The TOR detail page shows a summary of the documents. **Today** it's one flat list written by the local Ollama model.

The customer wants it as **three topics**, one card each:

| Card | Key | What goes in it |
|---|---|---|
| **วัตถุประสงค์** | `objective` | why the agency is buying this (usually 1–2 points) |
| **ขอบเขตงาน** | `scope` | what the winner must deliver: licences, installation, reports, deadlines |
| **คุณสมบัติผู้เสนอราคา** | `qualifications` | who may bid: legal status, authorised reseller, past work ≥ ฿X |

When the document doesn't state a topic, that card says *"ยังไม่มีข้อมูลส่วนนี้จาก Procurement"* ("no data for this section from Procurement yet"). It must **never** be filled with an invented point.

So we give Gemini the **whole text in one call** and ask it to sort what it finds into those three topics, at most 5 points each, with each point tagged with the PDF it came from. After this branch, Ollama is gone from the codebase entirely.

### What Gemini answers, and what we store

```jsonc
// Gemini (forced by the schema):
{ "objective":      [ { "text": "…", "filename": "doc_1.pdf" } ],
  "scope":          [ { "text": "ต่ออายุสิทธิ์การใช้งาน UiPath จำนวน 6 ไลเซนส์", "filename": "doc_1.pdf" } ],
  "qualifications": [ { "text": "มีผลงานประเภทเดียวกันไม่น้อยกว่า 1,800,000 บาท", "filename": "doc_1.pdf" } ] }

// stored on the TOR (summaryBullets), and served as summaryPoints:
[ { "section": "objective", "text": "…", "filename": "doc_1.pdf" },
  { "section": "scope", … }, { "section": "qualifications", … } ]
```

Three arrays in the **schema** make the model sort its points; storing them **flat** with a `section` tag keeps the database and API shape almost the same as today. The constants are given in `src/lib/ai/types.ts`: `SUMMARY_SECTIONS` (the three keys, in page order), `MAX_POINTS_PER_SECTION = 5` and `MAX_BULLETS = 15`.

### The rule that matters most here: FR-19, describe and never judge

A grade is private. **Summary points are public**, and they're written by an AI about a *named government agency*. A point like *"เงื่อนไขนี้ไม่เป็นธรรม"* ("this condition is unfair") reads as an accusation. The qualifications card is where that temptation is strongest: *"requires an authorised UiPath reseller"* is a fact, while *"restricts competition to one vendor"* is a judgement. There are three layers of protection, and you'll build or keep all three:

1. the **prompt** forbids judging;
2. **`parseSummary`** drops any judgemental point (`isDescriptive` in `summaryGuard.ts`);
3. **`sanitizeBullets`** screens again before saving, and once more before serving.

---

## Passing criteria (ALL must be true)

| # | Check | Command |
|---|---|---|
| 1 | The summary module spec is green | `bun test src/lib/ai/vertexSummary.test.ts` |
| 2 | The FR-19 screen tests are green | `bun test src/lib/ai/summaryGuard.test.ts` |
| 3 | The API serializer tests are green | `bun test src/modules/tor` |
| 4 | The wiring checklist is green | `bun test checklist/92` |
| 5 | **Every** test in the repo is green (90 and 91 included) | `bun test` |
| 6 | TypeScript is happy | `bun run typecheck` |
| 7 | It works for real | one real TOR shows three topics (step 10) |

Right now 26 tests are red, all of them this branch's. Everything from 90, 91 and `main` is green; keep it that way.

---

## Steps

### Step 1: change the types

**File:** `src/lib/ai/types.ts` (there are TODOs next to both types)

- `SummaryBullet` becomes `{ section: SummarySection | null; text: string; filename: string | null }`.
  `section` is `null` only for rows stored before topics existed (`SUMMARY_VERSION` 1); everything new has one.
- `SummaryInput` becomes `{ text: string; files: FileSpan[] }`: the same stored text and file list the grader reads.

Run `bun run typecheck`. Its errors are your to-do list for the rest of this branch.

✅ `bun test checklist/92`: both "step 1" checks.

### Step 2: keep the topic and the filename through the screen

**File:** `src/lib/ai/summaryGuard.ts` → `sanitizeBullets` currently pushes `{ text }`. Make it keep:
- `section`, but only if it's one of `SUMMARY_SECTIONS`; anything else (missing on an old row, or junk) becomes `null`;
- `filename`, if it's a string, otherwise `null`.

✅ `bun test src/lib/ai/summaryGuard.test.ts`, and `bun test checklist/92`: step 2.

### Step 3: the three pure helpers

**File:** `src/lib/ai/vertexSummary.ts` (stubs with hints above each one).

- `summarySchema(filenames)`: an `OBJECT` with **one `ARRAY` per topic**, keys in `SUMMARY_SECTIONS` order, all required, each with `maxItems: MAX_POINTS_PER_SECTION`. Each item is `{ text, filename }`, where `filename` is an **enum** of the real filenames, so the model can't invent a file. Compare `gradeSchema` in `vertex.ts`.
- `buildSummaryPrompt(text)`: name the three topics **by their keys** and say what each means (the table above). Say that a topic the document doesn't state is an **empty list**. Then the FR-19 rules: describe, never evaluate, no fair/unfair/restrictive, no intent, no advice. Then Thai, length limits, figures, and which file. `src/lib/ai/ollama.ts` → `buildSummaryPrompt` has the FR-19 wording to start from; read it before deleting it in step 9.
- `parseSummary(raw, files)`: never trust the answer. Walk `SUMMARY_SECTIONS` **in order** (so the output follows the page, whatever order the JSON came in), and cap **per topic**, not overall. The stub's comment lists every case.

✅ `bun test src/lib/ai/vertexSummary.test.ts -t "step 3"`

### Step 4: `createVertexSummarizer`

It's the same shape as your `createVertexGrader`. Reuse `callGemini` from `./vertex.ts`. Empty text means no call. The `filename` enum comes from `files.map((f) => f.filename)`.

✅ `bun test src/lib/ai/vertexSummary.test.ts` is fully green.

### Step 5: use it

`src/lib/ai/index.ts` → `createSummarizer()` always returns `createVertexSummarizer()` from `./vertexSummary.ts`. Remove the `AI_PROVIDER` switch and the `ollama.ts` import.

✅ `bun test checklist/92`: step 5.

### Step 6: summarize the stored text

**File:** `src/modules/grade/grade.service.ts` → `gradeTor`. `text` and `files` are already loaded from `tor_texts` there; call `summarizer.summarize({ text, files })`. Keep the `sanitizeBullets(...)` around it, and keep it inside the `try/catch`: a failed summary must **never** fail the grade.

✅ `bun test checklist/92`: step 6.

### Step 7: storage

**File:** `src/modules/tor/tor.model.ts`
- `SUMMARY_VERSION = 2`
- in the `summaryBullets` sub-document, add
  `section: { type: String, enum: [...SUMMARY_SECTIONS, null], default: null }` and
  `filename: { type: String, default: null }`.
  The `null` in the enum is what lets old rows still load.

✅ `bun test checklist/92`: step 7.

### Step 8: serve the topic and the citation

**File:** `src/modules/tor/tor.serialize.ts` → `serializeDetail`, plus the `PublicTorSummaryPoint` type above it.
- Add `section: SummarySection | null` to `PublicTorSummaryPoint`.
- When mapping stored bullets into `sanitizeBullets(...)`, pass `section` and `filename` through, not just `text`.
- Each point gets `section` and `filename` from the screened bullet. `pageStart`/`pageEnd` stay `0`.

The frontend groups points into cards by `section`, and leaves out points with `section: null` (old rows). That's why the stretch goal below matters.

✅ `bun test src/modules/tor`

### Step 9: remove Ollama for good

- Delete `src/lib/ai/ollama.ts`.
- `src/config/env.ts`: remove `aiProvider`, `ollamaUrl` and `ollamaModel`. `src/grade-worker.ts` logs `env.aiProvider` at startup, so fix that line too.
- `.env.example`: remove `AI_PROVIDER` and the `OLLAMA_*` lines (keep `AI_TIMEOUT_MS`).
- `src/lib/ai/vertex.ts`: delete the placeholder `createVertexSummarizer` at the bottom (the real one now lives in `vertexSummary.ts`), and its now-unused `Summarizer` import.
- Search for leftovers: `grep -rn "ollama\|aiProvider" src`.

✅ `bun test`: everything green. `bun run typecheck`: no errors.

### Step 10: see it on a real TOR

With your key in `.env` and a TOR that has `tor_texts`:

```sh
bun run dev
curl -X POST localhost:8003/api/grade/run -H 'content-type: application/json' -d '{"limit":1}'
# wait ~1 minute, then find the TOR's id in Compass and:
curl -s localhost:8003/api/tors/<id> | jq '.summaryPoints | group_by(.section) | map({section: .[0].section, n: length})'
```

Check:
- [ ] points in all three topics where the document states them; at most 5 per topic
- [ ] **objective** says *why*, **scope** says *what*, **qualifications** says *who may bid*; nothing filed under the wrong card
- [ ] a topic the TOR doesn't cover is simply absent, not padded with a vague point
- [ ] **no** point that judges: nothing about fair/unfair, restrictive, suspicious, or advice to bidders (check qualifications hardest)
- [ ] most points have a `filename`, and it's one of the TOR's real PDFs
- [ ] in Compass: `summaryModel: "vertex:gemini-2.5-flash"`, `summaryVersion: 2`, and every bullet has a `section`

If a judgemental point gets through, don't just edit the prompt. Add the phrase to `EVALUATIVE_MARKERS` in `summaryGuard.ts` and write a test for it. The screen is the thing that can't be talked around.

---

## Stretch (not covered by tests)

- **Re-summarize old rows.** Every TOR graded before this branch has `summaryVersion: 1` and bullets with no `section`, so the frontend shows its three cards empty. Find them (`summaryVersion: { $lt: SUMMARY_VERSION }`) and re-run only the summary for them, not the grade. A tiny script in `src/` like the other `backfill-*` ones does it.
- **Objective from the portal.** Many announcements state the objective in their own fields. If the documents don't, the card could fall back to that, but only if it's a real field, never a guess.

---

## Using AI to help (without having it write the code for you)

Write your attempt first, then ask for **hints**:

- *"Here's my `parseSummary` and the failing test. Which case am I missing? Don't write the fix."*
- *"Read my summary prompt. Could it lead the model to file a qualification under scope? Point to the sentence only."*
- *"Read my prompt. Is there any way it still invites the model to judge the qualifications? List the risky phrases only."*
- *"What does `Object.fromEntries` do? Tiny example, not my code."*

When all seven criteria pass: commit, push, and open a PR. Then do the frontend half. That completes the Vertex migration. 🎉
