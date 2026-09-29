# feat/91: AI classification (the grading rulebook on Vertex AI)

> **You write the code on this branch.** The tests are the spec. When they're all green, the branch is done.
>
> **Before you start:** bring your finished branch 90 in, since this branch needs `tor_texts`:
> ```sh
> git switch feat/91/ai-classification
> git merge feat/90/pdf-extraction
> ```
> Setup and syntax help: [`docs/learning/`](docs/learning/README.md).

---

## Why this branch exists

Every TOR is graded against a **rulebook** of 15 rules (`src/lib/grade/rules.ts`), for example:
- `PENALTY`: a late-delivery fine clause (unfair when above 0.2% a day);
- `NOENTITY`: the document doesn't require a registered company.

Two rules are checked by plain code (`IDMISMATCH`, `BUDGETMISMATCH`). Most of the rest need an AI to *read* the document.

**Today** that AI is a small local model (Ollama). It reads one 6,000-character chunk at a time, so each TOR needs about 40 calls. A "router" (`src/lib/ai/route.ts`) guesses which chunks to send for which rule.

**Now** branch 90 gives us the whole text in one field, and Gemini can read all of it. So:

> For each phase (legitimacy, then fairness), send **all its rules + the whole text in ONE Gemini call**, and get back one `{ code, present, quote }` per rule.

### The one rule you must not break: never trust the AI

The AI can invent a quote. So a rule only counts as **fired** if its quote really appears in the document (`isVerbatim` in `types.ts`). This check happens twice: once when the answer comes back (`keepVerifiedFindings`), and again before anything is saved (`grade.service.ts`). A made-up quote is thrown away, never stored.

### How Gemini is called

With a plain `fetch`. There's no SDK and no service account. Your Vertex "express mode" key goes in the URL:

```
POST https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-flash:generateContent?key=YOUR_KEY
```

We send a **JSON schema** along with the prompt, and Gemini is forced to answer in exactly that shape. That means there's no free text to pick apart, just `JSON.parse`.

---

## Passing criteria (ALL must be true)

| # | Check | Command |
|---|---|---|
| 1 | The Vertex module spec is green | `bun test src/lib/ai/vertex.test.ts` |
| 2 | The wiring checklist is green | `bun test checklist/91` |
| 3 | Branch 90 is still green | `bun test checklist/90` |
| 4 | **Every** test in the repo is green | `bun test` |
| 5 | TypeScript is happy | `bun run typecheck` |
| 6 | It works for real | one real TOR graded with your key (step 11) |

Tests 1–5 never call Google. They use a fake `fetch`, so they're free and don't need a key.

---

## Steps

### Step 1: settings

- `src/config/env.ts`: add `vertexApiKey` (from `VERTEX_API_KEY`, default `""`) and `vertexModel` (from `VERTEX_MODEL`, default `"gemini-2.5-flash"`).
- `.env.example`: add `VERTEX_API_KEY=` (**empty**, because this file is committed) and `VERTEX_MODEL=gemini-2.5-flash`, with a comment on where to get a key.
- Your own `.env`: put your real key there. `.env` is git-ignored. **Never** paste a key anywhere else.

✅ `bun test checklist/91`: step 1.

### Step 2: change the types

**File:** `src/lib/ai/types.ts`

- `RuleFinding`: remove `chunkIndex` and add `checked: boolean` plus `filename: string | null`.
- `GradeInput`: becomes `{ rules, text, files }`. `text` is the full text and `files` is the `FileSpan[]` from branch 90.
- `Grader`: rename the method from `gradeChunks(...)` to `grade(input: GradeInput)`.

Then run `bun run typecheck`. The errors it lists are your to-do list for steps 7–10.

✅ `bun test checklist/91`: both step 2 checks.

### Step 3: `locateQuote`

**File:** `src/lib/ai/types.ts` (the stub is at the bottom). It finds *where* a quote sits in the text, even when the spacing differs. You need this so you can tell which PDF a quote came from.

✅ `bun test src/lib/ai/vertex.test.ts -t "step 3"`

### Step 4: `callGemini` and `assertVertexConfig`

**File:** `src/lib/ai/vertex.ts`. The comment above `callGemini` shows the exact request and reply shapes. The tests replace `fetch` with a fake, so read them to see exactly what's expected. Order inside `callGemini`:
1. `assertVertexConfig()` (throws if there's no key, so `fetch` is never reached);
2. `fetch(url, { method: "POST", headers, body: JSON.stringify(...) , signal })`;
3. `!response.ok` → throw (include the status, **not** the URL, because the URL contains the key);
4. read the JSON, check `promptFeedback.blockReason` and `candidates[0].finishReason === "STOP"`;
5. `JSON.parse` the text of `candidates[0].content.parts`, and throw a clear error if it fails.

✅ `bun test src/lib/ai/vertex.test.ts -t "step 4"`

### Step 5: the three pure helpers

**File:** `src/lib/ai/vertex.ts`

- `gradeSchema(codes)`: the answer shape. `code` must be an `enum` of `codes`, so the model can't invent rules.
- `buildGradePrompt(rules, text)`: **define** each rule; don't just name it. We measured this on the old model: asking about a bare rule name scored 0/3, while giving the definition scored 3/3. Include the definition, `unfairWhen` and the cue words, demand a WORD-FOR-WORD quote of at most `MAX_EVIDENCE_CHARS` characters (at 200 characters the old model quoted exactly; longer quotes drifted into paraphrase), and append the whole text.
- `keepVerifiedFindings(raw, rules, text, files)`: the gate. The comment above it lists all four cases. Loop over **your** rules, not the model's answers, so every rule gets exactly one finding.

✅ `bun test src/lib/ai/vertex.test.ts -t "step 5"`

### Step 6: `createVertexGrader`

It glues steps 4 and 5 together: one `callGemini` per `grade()`, with a timeout (`AbortController` + `setTimeout(..., env.aiTimeoutMs)`, cleared in `finally`).

✅ `bun test src/lib/ai/vertex.test.ts` is fully green.

### Step 7: use it

`src/lib/ai/index.ts` → `createGrader()` always returns `createVertexGrader()`. The summarizer keeps its `AI_PROVIDER` switch until branch 92.

### Step 8: grade the stored text

**File:** `src/modules/grade/grade.service.ts` → `gradeTor`

1. Remove the branch 90 "one chunk" bridge. Use `stored.fullText` and `stored.files` directly.
2. `checkDeterministic(tor, text)` searches the full text instead of joined chunks.
3. `grader.grade({ rules: aiRulesFor("legitimacy"), text, files })`, and the same for fairness.
4. `toFindings(raw, text)`: the **second** gate. Re-check `isVerbatim(f.evidence, text)` and keep `checked` and `filename`.
5. When saving `ruleFindings`, store `filename`.
6. The summary still expects chunks until branch 92, so give it `[{ index: 0, headingPath: [], text }]` for now.
7. Look at `findUngraded()`. Old TORs are already `"graded"` (version 1) and must be regraded **without** leaving the public list. Make it pick up both `extraction_pending` TORs and `graded` TORs whose `graderVersion` is older than the current one, but only TORs that have a `tor_texts` row (`TorTextModel.distinct("torId")`).

✅ `bun test checklist/91`: step 8.

### Step 9: storage and API

- `src/modules/tor/tor.model.ts`: `GRADER_VERSION = 2`, and add `filename` to the `ruleFindings` sub-document. Keep `chunkIndex` so old rows still load.
- `src/lib/grade/score.ts`: add `filename?: string | null` to `Finding`.
- `src/modules/tor/tor.serialize.ts` → `serializeGrade`: include `filename` in each finding.

✅ `bun test checklist/91`: the step 9 checks.

### Step 10: clean up

- Delete `src/lib/ai/route.ts` and `src/lib/ai/route.test.ts`, since there are no chunks left to route.
- In `src/lib/ai/ollama.ts`, delete the grader half (`buildPrompt`, `askOne`, `createOllamaGrader`) and keep the summarizer for now.
- `src/grade-worker.ts`: call `assertVertexConfig()` at startup, and log `env.vertexModel`.

✅ `bun test`: everything green. `bun run typecheck`: no errors.

### Step 11: grade one real TOR

You need your key in `.env` and at least one TOR with a `tor_texts` row (from branch 90).

```sh
bun run dev                       # tab 1
curl -X POST localhost:8003/api/grade/run -H 'content-type: application/json' -d '{"limit":1}'
curl localhost:8003/api/grade/status
```

Then, in MongoDB Compass, open that TOR in `tors` and check:
- [ ] `graderModel` is `vertex:gemini-2.5-flash`, and `graderVersion` is `2`
- [ ] every fired finding has an `evidence` quote you can find (Ctrl+F) in that TOR's `tor_texts.fullText`
- [ ] every fired finding has a `filename`

Expect about 20 seconds per Gemini call. It costs money per call, so grade a handful, not hundreds, while testing.

---

## Something to think about (and discuss)

On a real TOR, `NOENTITY` **fired**, with the quote *"เป็นบุคคลธรรมดาหรือนิติบุคคล…"*. But that quote shows the TOR *does* ask for a juristic person, and the rule means "the requirement is **missing**".

The prompt asks "does the document **contain** such a clause?", and that question doesn't fit rules that are about something being *absent*. (The old Ollama prompt had the same problem.) How would you fix it: change the rule's `definition`, add a field to `RuleSpec`, or phrase the prompt differently for absence rules? Try one, and grade the same TOR again.

---

## Using AI to help (without having it write the code for you)

Write your attempt first, then ask for **hints**:

- *"Here's my `callGemini` and the failing test output. What's the test expecting that I'm not doing? One sentence, no code."*
- *"What does `AbortController` do? Give a 5-line example unrelated to my code."*
- *"Why would checking a quote with `includes` fail when the only difference is spaces? Don't give me code."*
- *"Here's my `keepVerifiedFindings`. Which of the four cases in the comment am I handling wrong?"*

When all six criteria pass: commit, push, and open a PR. Then move on to `feat/92/tor-ai-summary`.
