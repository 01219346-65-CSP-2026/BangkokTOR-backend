# feat/90: PDF extraction (whole text instead of chunks)

> **You write the code on this branch.** This file tells you what to build, in which order, and how you know you're done. The tests are the spec. When they're all green, the branch is finished.
>
> First time here? Do the setup in [`docs/learning/README.md`](docs/learning/README.md), and keep [`docs/learning/syntax-cheatsheet.md`](docs/learning/syntax-cheatsheet.md) open while you work.

---

## Why this branch exists

A TOR arrives as a `.zip` full of PDFs. Before any AI can read it, we turn the PDFs into text.

**Today** the text is cut into **chunks** of about 6,000 characters (at most 24 per TOR) and saved in the `tor_chunks` collection. That was only needed because the old local AI could read about 6,000 characters at a time.

**We're switching to Google Vertex AI (Gemini)**, which reads about a million tokens at once. So the goal of this branch is:

> Store the **whole readable text of a TOR in one field**, in a new `tor_texts` collection. No more chunks.

There's also a bug to fix along the way. The PDF reader keeps **list** and **table** text in a different place from paragraphs, and the current code never looks there. On a real TOR it keeps 14,213 characters out of 45,185. Your version must read lists and tables too; the tests check this.

## The flow you're changing

```
data/blobs/xxxx.zip
  │ unzipBundle()   src/lib/extract/unzip.ts    (already works, don't touch)
  ▼
  │ loadBundle()    src/lib/extract/loader.ts   (already works; PDF → JSON tree)
  ▼
  │ triageBundle()  src/lib/extract/triage.ts   (already works; keeps readable PDFs, best first)
  ▼
  │ chunkDocuments()  ✗ REMOVE                   →  buildFullText()  ★ YOU WRITE
  ▼
  │ ChunkModel.insertMany()  ✗ REMOVE            →  TorTextModel.updateOne(upsert)  ★ YOU WRITE
  ▼
MongoDB: tor_chunks ✗                            →  tor_texts ★
```

All of this runs inside `processBundle()` in `src/modules/extract/extract.service.ts`. Read that function once before you start.

---

## Passing criteria (the branch is done when ALL of these are true)

| # | Check | Command |
|---|---|---|
| 1 | Unit tests for your text builder are green | `bun test src/lib/extract/fulltext.test.ts` |
| 2 | The wiring checklist is green | `bun test checklist/90` |
| 3 | The API serializer tests are green | `bun test src/modules/tor` |
| 4 | **Every** test in the repo is green | `bun test` |
| 5 | TypeScript is happy | `bun run typecheck` (no errors) |
| 6 | It works on real data | run the extract worker once, then check `tor_texts` in MongoDB Compass (step 8) |

Right now most of these fail. That's expected. Work through the steps and watch them turn green.

---

## Steps

Do them in order. Each one says which test turns green when you're done.

### Step 1: teach the `LoaderNode` type about lists and tables

**File:** `src/lib/extract/loader.ts` → the `LoaderNode` type.

Open any file in `data/extracted/<number>/_json/` (or print one with `bun -e`) and find a node with `"type": "list"` and one with `"type": "table"`. Notice where their text actually lives:
- a list keeps it in `"list items"`, which is an array of nodes;
- a table keeps it in `rows`, and each row has `cells`, which are nodes with `kids`.

Add both as **optional** fields on `LoaderNode`. The field name `"list items"` has a space in it, so it needs quotes.

✅ `bun test checklist/90`: "step 1" passes.

### Step 2: write `pdfToText`, `buildFullText`, `fileAt`

**File:** `src/lib/extract/fulltext.ts`. The types are given; the three function bodies are yours. Each function has hints above it.

Suggested order:
1. `fileAt`: the smallest. Get its test green first.
2. `pdfToText`: you'll want a helper function that calls itself for each child node (recursion). Start with paragraphs only, then add lists, then tables. There's one test for each.
3. `buildFullText`: uses `pdfToText`. The trickiest parts are the `start`/`end` offsets and the size cap. Draw it on paper:
   ```
   "=== FILE: a.pdf ===\nAAA" + "\n\n" + "=== FILE: b.pdf ===\nBBB"
    ^0                    ^23   (sep)    ^25                   ^48
   ```

✅ `bun test src/lib/extract/fulltext.test.ts`: all 11 pass.

### Step 3: create the `tor_texts` model

**Create:** `src/modules/extract/torText.model.ts`
**Copy the pattern from:** `src/modules/extract/extraction.model.ts` (same imports, same `new Schema(...)`, `model(...)` shape).

Fields:

| field | type | notes |
|---|---|---|
| `torId` | ObjectId, ref `"Tor"` | required |
| `projectId` | String | required |
| `documentId` | ObjectId, ref `"Document"` | required, the bundle it came from |
| `fullText` | String | required |
| `chars` | Number | required |
| `truncated` | Boolean | default `false` |
| `files` | array of `{ filename, pages, start, end }` | `_id: false` on the sub-object, default `[]` |

Options: `{ timestamps: true, versionKey: false, collection: "tor_texts" }`.
Index: `torId` **unique**, because there's exactly one text per TOR.
Export `TorTextModel`, plus a `TorTextLean` type the way the other models do.

✅ `bun test checklist/90`: "step 3" passes.

### Step 4: add the `MAX_FULLTEXT_CHARS` setting

- `src/config/env.ts`: add `maxFulltextChars: Number(process.env.MAX_FULLTEXT_CHARS ?? 400_000)` next to `extractDir`.
- `.env.example`: add `MAX_FULLTEXT_CHARS=400000`, with a one-line comment explaining it.

Why a cap: every stored character is sent to a paid AI later. 400,000 is generous, and 2 of our 5 test bundles hit it.

✅ `bun test checklist/90`: "step 4" passes.

### Step 5: save the whole text in `processBundle`

**File:** `src/modules/extract/extract.service.ts`

1. Replace the `chunkDocuments(...)` + `ChunkModel.deleteMany/insertMany` block with:
   - `const full = buildFullText(triaged.readable, env.maxFulltextChars);`
   - if `full.chars === 0`, mark the TOR incomplete with reason `"no-text"` and return (look at how `"scanned-only"` is handled just above);
   - `TorTextModel.updateOne({ torId: row.torId }, { $set: {...every field...} }, { upsert: true })`.
     **upsert** means "update it, or create it if it doesn't exist", so running extraction twice never makes two copies.
2. In `src/modules/extract/extraction.model.ts`, rename the `chunkCount` field to `textChars`. Then fix every place TypeScript now complains about (`bun run typecheck` lists them). Set `textChars: full.chars`.
3. In `getExtractStatus()`, count `TorTextModel` documents instead of chunks.

✅ `bun test checklist/90`: both "step 5" checks pass.

### Step 6: point the readers at `tor_texts`

Two places still read chunks:

- **`src/modules/tor/tor.service.ts`** → `getTorDetail`: load `TorTextModel.findOne({ torId: tor._id })` instead of the chunks. Only `documentId` and `files` are needed, so use `.select("documentId files")`, which stops Mongo from sending the big text.
- **`src/modules/tor/tor.serialize.ts`** → `serializeDetail(tor, documents, text)`: the third argument is now that row (or `null`).
  - A document's `pages` = the **sum** of `files[].pages` for the bundle it came from.
  - Summary points get `filename: null, pageStart: 0, pageEnd: 0` for now (branch 92 brings citations back).
  - The tests in `src/modules/tor/tor.serialize.test.ts` are already updated. Make them pass.
- **`src/modules/grade/grade.service.ts`** → `gradeTor`: load the `TorTextModel` row. If there isn't one, mark the TOR `extraction_incomplete` with reason `"no-text"`. The grader still expects chunks until branch 91, so hand it **one** chunk for now: `[{ index: 0, headingPath: [], text: stored.fullText }]`. Leave a comment saying branch 91 replaces this.

✅ `bun test src/modules/tor` and `bun test checklist/90`: "step 6" passes.

### Step 7: delete the chunk code

Delete `src/lib/extract/chunk.ts`, `src/lib/extract/chunk.test.ts` and `src/modules/extract/chunk.model.ts`. Then run `bun run typecheck` and fix anything still importing them (`monitor.service.ts` reads `chunkCount`; make it `textChars`).

✅ `bun test checklist/90` is fully green. `bun run typecheck` shows no errors. `bun test` is fully green.

### Step 8: try it on real data

With Mongo running (`docker compose up -d mongo`) and `MONGODB_URI=mongodb://localhost:27017` in `.env`:

```sh
bun run dev              # tab 1
bun run worker           # tab 2 — downloads a bundle or two, then Ctrl+C
bun run extract-worker   # tab 3
curl -X POST localhost:8003/api/extract/run -H 'content-type: application/json' -d '{"limit":2}'
```

Open **MongoDB Compass** → `bangkoktor` → `tor_texts`, then check:
- [ ] one document per TOR, with a `fullText` that starts with `=== FILE: `
- [ ] `files[i].start`/`end` line up: the text at `start` is that file's header
- [ ] `chars` equals the length of `fullText`
- [ ] no new documents appear in `tor_chunks`

---

## Stretch (worth doing before this goes to production)

These two aren't covered by tests. They matter because the live database already has TORs that were extracted the old way.

- **Re-extract old TORs.** Their `extraction_queue` rows already say `done`, so nothing will ever redo them. In `enqueuePending()`, set those rows back to `pending` when their `torId` has no `tor_texts` row yet (only if `digitalCount > 0`). Hint: `TorTextModel.distinct("torId")` and `$nin`.
- **Don't hide graded TORs.** The public list only shows `graded` TORs. Re-extracting sets a TOR back to `extraction_pending`, which would make it vanish. Only change the status when it isn't already `"graded"` (`{ _id: row.torId, status: { $ne: "graded" } }`).

---

## Using AI to help (without having it write the code for you)

Write your attempt first. When you're stuck, paste your code and **the failing test output** and ask for a *hint*, not a solution. Prompts that work well:

- *"Here's my `pdfToText` and the failing test. Don't fix it. Tell me in one sentence which case I'm not handling."*
- *"Explain what `{ upsert: true }` does in Mongoose `updateOne`, with a tiny example that isn't my code."*
- *"I get this TypeScript error: `<paste>`. What does it mean? Don't rewrite my code."*
- *"Review my `buildFullText` for off-by-one mistakes in start/end. Point to the line, don't rewrite it."*

When all six passing criteria hold, commit, push, and open a PR into `main`. Then move on to `feat/91/ai-classification`.
