# Learning the BangkokTOR backend

This folder is a guided tour. Read the files in this order:

1. **This file**: set up your machine and run the pipeline once.
2. [`syntax-cheatsheet.md`](syntax-cheatsheet.md): every TypeScript construct you'll meet, with an example from this repo.
3. **`LEARNING.md` at the repo root.** Every feature branch has its own, telling you what to build on that branch and the **passing criteria**. Do the branches in order, because each builds on the one before:

| Branch | You build |
|---|---|
| `feat/90/pdf-extraction` | PDFs → one text per TOR, stored in `tor_texts` |
| `feat/91/ai-classification` | Vertex AI checks the grading rulebook against that text |
| `feat/92/tor-ai-summary` | Vertex AI writes a short, neutral summary of that text |

Before starting the next branch, bring your finished work into it:

```sh
git switch feat/91/ai-classification
git merge feat/90/pdf-extraction     # your finished 90 work comes along
```

On each branch, the tests are the spec. They fail when you arrive, and the branch is done when they're all green.

---

## What the project does, in one picture

```
 data.go.th (government portal)
        │
        ▼
 ┌──────────────┐   finds new tenders, downloads each one's .zip of PDFs
 │ 1. INGEST    │   src/worker.ts           → collections: tors, documents
 └──────┬───────┘
        ▼
 ┌──────────────┐   unzips, reads the PDFs, keeps the ones with real text,
 │ 2. EXTRACT   │   joins them into ONE long string
 └──────┬───────┘   src/extract-worker.ts   → collection: tor_texts
        ▼
 ┌──────────────┐   sends that text to Google Vertex AI (Gemini):
 │ 3. GRADE +   │   - does it contain each rule's clause? (with a quote)
 │    SUMMARY   │   - a short, neutral summary
 └──────┬───────┘   src/grade-worker.ts     → fields on tors
        ▼
   API (src/server.ts) → the frontend shows it
```

Every stage is a separate program (a "worker") that reads work from MongoDB, does it, and writes the result back. If one crashes, restart it and it carries on.

---

## Setup (do these once)

You need three things on your machine: **Bun**, **Docker**, and the repo.

1. **Install Bun** (runs TypeScript directly, with no build step):
   ```sh
   curl -fsSL https://bun.sh/install | bash
   ```
2. **Install Docker Desktop**: https://www.docker.com/products/docker-desktop/
3. **Install the project's packages** (run inside this repo folder):
   ```sh
   bun install
   ```
4. **Start a local database.** It runs in Docker and only listens on your own machine:
   ```sh
   docker compose up -d mongo
   ```
5. **Create your `.env` file** (your private settings, never committed):
   ```sh
   cp .env.example .env
   ```
   Then open `.env` and check these lines:
   ```sh
   MONGODB_URI=mongodb://localhost:27017   # your LOCAL database. Don't point this at the shared Atlas cluster while learning.
   DATAGOTH_KEY=...                        # ask the team; needed only to download new tenders
   ```
   From branch 91 onwards you also need:
   ```sh
   AI_PROVIDER=vertex
   VERTEX_API_KEY=...                      # see "Getting a Vertex API key" below
   ```

### Getting a Vertex API key (express mode)

1. Go to https://console.cloud.google.com/vertex-ai/studio and sign in.
2. Choose **"Get API key"** (Vertex AI express mode). You don't need a service account.
3. Copy the key into `.env` as `VERTEX_API_KEY=...`.
4. **Never commit it.** `.env` is already in `.gitignore`.

---

## Run it once

Open **four terminal tabs** in the repo folder:

| Tab | Command | What it does |
|---|---|---|
| 1 | `bun run dev` | The API on http://localhost:8003 |
| 2 | `bun run worker` | Ingest: finds and downloads tenders |
| 3 | `bun run extract-worker` | Extract: PDFs → text |
| 4 | `bun run grade-worker` | Grade + summary (from branch 91) |

Then, in a fifth tab, ask the pipeline to process 1 TOR:

```sh
./scripts/backfill.sh 1
```

Check it's alive:

```sh
curl http://localhost:8003/health            # {"ok":true}
curl http://localhost:8003/api/extract/status
```

To look inside the database, install **MongoDB Compass** (a free app), connect to `mongodb://localhost:27017`, and open the `bangkoktor` database. You'll see the collections `tors`, `documents`, `tor_texts`, and so on.

---

## Everyday commands

```sh
bun test                         # run every test
bun test src/lib/extract         # run only the tests in one folder
bun run typecheck                # ask TypeScript to check types (no output = good)
git switch feat/90/pdf-extraction  # move to a branch
git switch -c my-try             # make your own branch to experiment on
```

## How the code is laid out

```
src/
  config/env.ts        every setting from .env, with defaults
  db/mongo.ts          connects to MongoDB
  lib/                 PURE logic: data in, data out, no database
    extract/             unzip, read PDFs, build the text   ← branch 90
    ai/                  talk to Vertex AI                  ← branches 91, 92
    grade/               the rulebook + scoring maths
  modules/<feature>/   one folder per feature:
    *.model.ts           the shape of a MongoDB collection
    *.service.ts         the work (uses models + lib)
    *.controller.ts      turns an HTTP request into a service call
    *.route.ts           which URL goes to which controller
  worker.ts, extract-worker.ts, grade-worker.ts   the background programs
```

**Rule of thumb:** logic you can test without a database goes in `lib/`. Anything that reads or writes MongoDB goes in `modules/…/*.service.ts`.
