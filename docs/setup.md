# Local setup

You need this API on **:8003** and the frontend on **:3003** to see anything
past the landing page. The frontend has its own `docs/setup.md`.

## Prerequisites

- [Bun](https://bun.sh) 1.x
- Docker Desktop, for local Mongo
- Java 11+, only if you run the extract worker (`@opendataloader/pdf` starts a JVM)
- Secrets from the team: a Vertex express key and the shared `ADMIN_TOKEN` /
  `INTERNAL_JWT_SECRET`. Never commit them.

## Run it

```bash
bun install
cp .env.example .env            # fill in the values (table below)
docker network create bangkoktor-net   # once per machine; compose expects it
docker compose up -d mongo      # mongo:7 on 127.0.0.1:27017
bun run dev                     # API on http://localhost:8003, restarts on save
curl localhost:8003/health/ready   # {"status":"ok", ... "mongo":{"ok":true}}
```

The database starts empty. To pull real TORs, run `bun run discover`, then
`bun run worker`.

## Processes

The API and each worker are separate processes. Start only what your task
touches.

| Command | What it does |
|---|---|
| `bun run dev` | The HTTP API |
| `bun run discover` | Find new projects in the source portals → `ingest_queue` |
| `bun run worker` | Fetch project details and documents |
| `bun run extract-worker` | PDF → text (needs Java) |
| `bun run grade-worker` | Legitimacy grade (needs `VERTEX_API_KEY`) |
| `bun run summarize-worker` | TOR summary bullets (needs `VERTEX_API_KEY`) |
| `bun run email-worker` | Send match digests |

One-off maintenance scripts: `backfill-pdfs`, `backfill-skills`,
`backfill-classify`, `backfill-province`, `refresh-bidding`,
`purge-out-of-scope`, `move-national-out`, `cleanup-document-files`,
`import-budget`, `backup-collections`, `restore-from-backup`. **Run
`backup-collections` before any script that writes to a shared database.**

## Environment variables

All variables are read in `src/config/env.ts`, which also holds the defaults.

| Variable | Needed for | Notes |
|---|---|---|
| `MONGODB_URI` | Boot | The only variable required to start |
| `MONGODB_DB_NAME` | — | Default `bangkoktor` |
| `PORT`, `NODE_ENV` | — | Default 8003 |
| `CORS_ORIGINS` | Browser calls | Default `http://localhost:3003` |
| `ADMIN_TOKEN` | Admin routes | **Must match the frontend.** Required in production; admin routes are open in dev if unset |
| `INTERNAL_JWT_SECRET` | Signed-in routes | **Must match the frontend.** Required in production; no secret means every user route returns 401 |
| `VERTEX_API_KEY`, `VERTEX_MODEL` | Grade, summarize | See [learning/README.md](learning/README.md) for getting a key |
| `RESEND_API_KEY` or `GMAIL_USER` + `GMAIL_APP_PASSWORD`, `MAIL_FROM`, `MAIL_PROVIDER`, `APP_URL` | Email | Logs to the console if unset |
| `DATAGOTH_KEY`, `EGP_FEED`, `EGP_FISCAL_YEAR` | Ingest | `EGP_FEED` = `all` / `bma` / `govspending` / `ckan` |
| `SOURCE_DIR`, `BLOB_DIR`, `EXTRACT_DIR`, `MAX_*` | Files on disk | Where downloads go, and size caps |
| `WORKER_*`, `HTTP_*`, `RATE_LIMIT_*`, `AI_TIMEOUT_MS`, `EMAIL_*` | Tuning | Defaults are fine locally |

`env.ts` also reads six variables that `.env.example` doesn't list:
`EGP_DELAY_MS`, `BMA_LOOKBACK_DAYS`, `BMA_MAX_PAGES`, `LIST_ALL_TORS`,
`HEARTBEAT_MS`, `CKAN_FISCAL_YEAR`. Add them to `.env.example` when you next
touch it.

## Before you push

```bash
bun run typecheck
bun test
```

CI runs neither (see [deployment.md](deployment.md)), so run them yourself.

Next: [team/workflow.md](team/workflow.md)
