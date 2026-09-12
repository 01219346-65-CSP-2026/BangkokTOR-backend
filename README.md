# BangkokTOR — backend

The API and data pipeline behind BangkokTOR: a searchable record of Thai
government procurement announcements (terms of reference, "TOR") published to
`process3.gprocurement.go.th`.

The source portal gives you a Thai title and a stack of PDFs, several of them
scanned. This service turns that into structured, queryable records.

---

## The pipeline

Three stages, each a separate worker process, each resumable:

```
ingest   →  discover announcements via CKAN, fetch PDFs politely,
            store blobs + document rows
extract  →  read the PDFs, split them into ~6k-character chunks on
            heading boundaries, persist to tor_chunks
grade    →  run each chunk past a local LLM as a binary clause detector,
            score against the rulebook, store the grade PRIVATELY
```

Two things about the grading stage that are easy to get wrong:

- **The model never writes prose.** For each rule it answers
  `{present: boolean, quote: string}` against one chunk. There is no summary
  generation anywhere in this codebase.
- **Every quote is verified verbatim** against the chunk before it is stored
  (`lib/ai/ollama.ts`, then again in `grade.service.ts`). A quote the model
  invented is dropped, not stored. This is FR-11.

## Stack

Bun, Express 5, Mongoose 9 — and deliberately nothing else. The runtime
dependency list is three packages and `AGENTS.md` asks you to keep it that way;
rate limiting and CORS are hand-rolled here for that reason. Bun runs the
TypeScript directly, so there is no build step.

## Layout

```
index.ts              entry → src/server.ts → src/app.ts
src/app.ts            the entire middleware stack, in order
src/config/env.ts     every environment variable, with defaults
src/middleware/       cors, rateLimit, limits, adminToken, requestLog, errors
src/modules/<feature>/  route → controller → service → model, per feature
src/lib/              ai, extract, grade, http, classify, thai, sources, worker
src/worker.ts         ingest worker      (bun run worker)
src/extract-worker.ts extract worker     (bun run extract-worker)
src/grade-worker.ts   grade worker       (bun run grade-worker)
```

A feature is a folder under `src/modules/`. `_template/` and `_thing/` are
scaffolding examples and are not mounted.

## Running it locally

```sh
bun install
cp .env.example .env     # then fill in MONGODB_URI at minimum
bun run dev              # API on :8003, watch mode
```

Mongo is the only hard requirement — `MONGODB_URI` is the one variable with no
default, and the server exits at boot without it. `docker compose up -d mongo`
gives you one on `127.0.0.1:27017`.

The workers are separate processes and only needed if you are working on the
pipeline itself:

```sh
bun run worker          # ingest
bun run extract-worker
bun run grade-worker    # needs Ollama on :11434
```

Checks: `bun run typecheck`, `bun test`.

## API

Everything is JSON. Reads are open; writes are not — see Access control.

| Method | Path | Notes |
|---|---|---|
| GET | `/` | banner |
| GET | `/health` | liveness; never rate-limited |
| GET | `/health/ready` | pings Mongo, 503 when down |
| GET | `/api/tors` | list; `q, agency, category, province, isSoftware, minBudget, maxBudget, page, limit` |
| GET | `/api/tors/stats` | corpus totals |
| GET | `/api/tors/agencies` | distinct agencies, for filter options |
| GET | `/api/tors/:id` | detail: documents + extracted sections |
| GET | `/api/tors/:id/grade` | 🔒 private grade + evidence |
| POST | `/api/ingest/run` | 🔒 starts a run, 202 |
| GET | `/api/ingest/status` | |
| POST | `/api/extract/run` | 🔒 |
| GET | `/api/extract/status` | |
| POST | `/api/grade/run` | 🔒 |
| GET | `/api/grade/status` | |
| GET | `/api/pipeline/status` | worker health |
| GET | `/api/pipeline/queue` | `?stage=ingest\|extract` |
| GET | `/api/pipeline/runs` | run history |
| GET/POST | `/api/user` | POST 🔒 |
| GET/PATCH/DELETE | `/api/user/:id` | PATCH, DELETE 🔒 |
| GET/POST | `/api/notification` | POST 🔒 |
| GET/PATCH/DELETE | `/api/notification/:id` | PATCH, DELETE 🔒 |
| GET/POST | `/api/techstack` | POST 🔒 |
| GET/PATCH/DELETE | `/api/techstack/:id` | PATCH, DELETE 🔒 |

🔒 = requires `X-Admin-Token`.

## Grade privacy (FR-19)

`modules/tor/tor.serialize.ts` is a gate, not a formatter. The grade is computed
and stored for auditability, but a public "Grade C — Legitimacy Failed" on a
named government agency is an accusation, and this project does not publish
those.

So the public shape carries neutral observations only — `{id, tone, titleKey,
bodyKey}`, i18n keys with no prose — and `PRIVATE_GRADE_FIELDS` is stripped from
every guest response. The full grade lives on its own route behind the admin
token.

**If you add a field to that serializer, ask whether a client could render it as
an accusation.** If it could, it does not belong there.

## Access control

There is no user auth yet (FR-01). What exists is a shared secret plus per-IP
rate limits, which is the smallest thing that stops an anonymous caller from
starting expensive pipeline runs or deleting rows.

`ADMIN_TOKEN` is sent as an `X-Admin-Token` header and guards every 🔒 route
above. It answers **404, not 403**, so it does not confirm the route exists.
The server refuses to boot in production without it.

Rate limits are per IP, fixed window, counted in memory:

| Tier | Limit | Routes |
|---|---|---|
| read | 120/min | `/api/tors/*` |
| pipeline | 60/min | `/api/pipeline/*`, `/api/*/status` |
| write | 20/min | user, notification, techstack |
| run | **2/hour** | `POST /api/*/run` |

Health is exempt, so a busy container is never marked unhealthy by its own
healthcheck. All four are configurable — see `.env.example`.

Counters are per-process. **Running more than one replica multiplies the
effective limit by the replica count**; that is the point at which this should
move to a shared store.

CORS is an allowlist reflected one origin at a time, never `*`
(`CORS_ORIGINS`). Note that CORS only constrains browsers — curl ignores it
entirely, which is why the limits and the token exist.

## Deployment

Two compose stacks plus a proxy, on one shared docker network:

```
router NAT → caddy:80 → frontend:3003 → backend:8003 (docker network only)
                                        mongo (127.0.0.1 only)
```

The backend publishes **no host port**. It is reached by service name from the
frontend container and is not addressable from outside the network.

First-time setup needs the shared network, which compose will not create:

```sh
docker network create bangkoktor-net
```

A push to `main` triggers a self-hosted runner that pulls into
`~/Prod/csp/<repo>` and runs `docker compose up -d --build`. Because the deploy
is a `git pull --ff-only`, **never edit files directly in the prod checkout** —
an uncommitted change there aborts every subsequent deploy.

See `~/Prod/csp/caddy/README.md` for the proxy and the TLS note.

## Conventions

`AGENTS.md` is the long version and is worth reading before a first PR. The
short version:

- Throw `HttpError(status, message)` from `middleware/errors.ts`. Express 5
  forwards rejected async handlers to the error handler automatically.
- Keep the dependency list at three packages.
- Comments explain *why*, especially where the obvious approach was rejected.
