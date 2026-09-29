# feat/92: TOR AI summary (whole text, one Vertex call)

> **You write the code on this branch.** The tests are the spec. When they're all green, the branch is done.
>
> **Before you start:** bring your finished branches 90 and 91 in, because this branch reuses your `callGemini`:
> ```sh
> git switch feat/92/tor-ai-summary
> git merge feat/91/ai-classification     # already contains your 90 work
> ```
> Setup and syntax help: [`docs/learning/`](docs/learning/README.md).

---

## Why this branch exists

The TOR detail page shows a few **summary points**: short Thai sentences such as *"ผู้ยื่นข้อเสนอต้องวางหลักประกัน ๔๖ ล้านบาท"*, each citing the PDF it came from.

**Today** the summary is written by the local Ollama model, 10 chunks at a time, one call per chunk.

**Now** we give Gemini the **whole text in one call** and ask for up to 8 points, each tagged with its `filename`. After this branch, Ollama is gone from the codebase entirely.

### The rule that matters most here: FR-19, describe and never judge

A grade is private. **Summary points are public**, and they're written by an AI about a *named government agency*. A point like *"เงื่อนไขนี้ไม่เป็นธรรม"* ("this condition is unfair") reads as an accusation, and the project must never publish one. So there are three layers of protection, and you'll build or keep all three:

1. the **prompt** forbids judging;
2. **`parseSummary`** drops any judgemental point (`isDescriptive` in `summaryGuard.ts`);
3. **`sanitizeBullets`** screens again before saving, and once more before serving.

For reference, on a real TOR the finished version produced 8 points like *"ค่าปรับ … ให้คิดในอัตราร้อยละ ๐.๒๐ … ต่อวัน"*: facts and figures, no opinions. That's the target.

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
| 7 | It works for real | one real TOR shows cited summary points (step 10) |

---

## Steps

### Step 1: change the types

**File:** `src/lib/ai/types.ts`

- `SummaryBullet`: replace `chunkIndex: number` with `filename: string | null`.
- `SummaryInput`: becomes `{ text: string; files: FileSpan[] }`. It's the same stored text the grader reads.
- Delete `GradeChunk` and `MAX_SUMMARY_CHUNKS`, since nothing uses chunks anymore.

Run `bun run typecheck`. Its errors are your to-do list for the rest of this branch.

✅ `bun test checklist/92`: step 1.

### Step 2: keep the filename through the screen

**File:** `src/lib/ai/summaryGuard.ts` → `sanitizeBullets` copies `filename` (instead of `chunkIndex`) onto each kept bullet. Its tests are already updated.

✅ `bun test src/lib/ai/summaryGuard.test.ts`, and `bun test checklist/92`: step 2.

### Step 3: the three pure helpers

**File:** `src/lib/ai/vertexSummary.ts` (stubs with hints). This is a new file on purpose, so it can't clash with your `vertex.ts` from branch 91.

- `summarySchema(filenames)`: like `gradeSchema`. `filename` is an **enum** of the real filenames, so the model can't invent a file.
- `buildSummaryPrompt(text)`: the instructions. The FR-19 part is the most important. There's a good starting point in `src/lib/ai/ollama.ts` → `buildSummaryPrompt` (read it before deleting it in step 9). Adapt it from "one section" to "the whole document, with files".
- `parseSummary(raw, files)`: never trust the answer. The comment lists every case.

✅ `bun test src/lib/ai/vertexSummary.test.ts -t "step 3"`

### Step 4: `createVertexSummarizer`

It's the same shape as your `createVertexGrader`. Reuse `callGemini` from `./vertex.ts`. Empty text means no call.

✅ `bun test src/lib/ai/vertexSummary.test.ts` is fully green.

### Step 5: use it

`src/lib/ai/index.ts` → `createSummarizer()` always returns `createVertexSummarizer()` from `./vertexSummary.ts`. Remove the `AI_PROVIDER` switch.

✅ `bun test checklist/92`: step 5.

### Step 6: summarize the stored text

**File:** `src/modules/grade/grade.service.ts` → `gradeTor`. Delete the "one chunk" bridge and call `summarizer.summarize({ text, files })`. Keep the `sanitizeBullets(...)` around it, and keep it inside the `try/catch`: a failed summary must **never** fail the grade.

✅ `bun test checklist/92`: step 6.

### Step 7: storage

**File:** `src/modules/tor/tor.model.ts`
- `SUMMARY_VERSION = 2`
- add `filename: { type: String, default: null }` to the `summaryBullets` sub-document. Keep `chunkIndex` so old rows still load.

When saving in `grade.service.ts`, the bullets now carry `filename`.

✅ `bun test checklist/92`: step 7.

### Step 8: show the citation again

**File:** `src/modules/tor/tor.serialize.ts` → `serializeDetail`. Each summary point's `filename` comes straight from the stored bullet (`bullet.filename ?? null`). `pageStart`/`pageEnd` stay `0`. The public shape doesn't change, so the frontend needs no changes.

✅ `bun test src/modules/tor`

### Step 9: remove Ollama for good

- Delete `src/lib/ai/ollama.ts`.
- `src/config/env.ts`: remove `aiProvider`, `ollamaUrl` and `ollamaModel`.
- `.env.example`: remove `AI_PROVIDER` and the `OLLAMA_*` lines.
- `src/lib/ai/vertex.ts`: delete the placeholder `createVertexSummarizer` at the bottom (the real one now lives in `vertexSummary.ts`).
- Search for leftovers: `grep -rn "ollama\|aiProvider" src`.

✅ `bun test`: everything green. `bun run typecheck`: no errors.

### Step 10: see it on a real TOR

With your key in `.env` and a TOR that has `tor_texts`:

```sh
bun run dev
curl -X POST localhost:8003/api/grade/run -H 'content-type: application/json' -d '{"limit":1}'
# wait ~1 minute, then find the TOR's id in Compass and:
curl localhost:8003/api/tors/<id> | jq .summaryPoints
```

Check:
- [ ] up to 8 points, in Thai, each one a fact from the document (figures, deadlines, requirements)
- [ ] **no** point that judges: nothing about fair/unfair, restrictive, suspicious, or advice to bidders
- [ ] most points have a `filename`, and it's one of the TOR's real PDFs
- [ ] in Compass, the TOR has `summaryModel: "vertex:gemini-2.5-flash"` and `summaryVersion: 2`

If a judgemental point gets through, don't just edit the prompt. Add the phrase to `EVALUATIVE_MARKERS` in `summaryGuard.ts` and write a test for it. The screen is the thing that can't be talked around.

---

## Using AI to help (without having it write the code for you)

Write your attempt first, then ask for **hints**:

- *"Here's my `parseSummary` and the failing test. Which case am I missing? Don't write the fix."*
- *"Read my summary prompt. Is there any way it still invites the model to judge the document? List the risky phrases only."*
- *"What does `enum` do in a JSON schema? Tiny example, not my code."*

When all seven criteria pass: commit, push, and open a PR. That completes the Vertex migration. 🎉
