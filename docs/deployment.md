# Environments & deployment

> Shared file, identical in the backend and frontend repos. Change both.

**A merge to `main` in either repo is live in production a couple of minutes
later, with no manual step and no test gate.** The UAT environment from our
[git workflow](team/workflow.md) does not exist yet; the right-hand column
below is what has to be built.

| | Production | UAT (`QA`) |
|---|---|---|
| Branch | `main` | `QA`, **not created yet** |
| Trigger | Push to `main` → `.github/workflows/deploy.yml` on a self-hosted runner on the Mac mini | To build: the same workflow, triggered on `QA` |
| What the job does | `git pull --ff-only` in `~/Prod/csp/BangkokTOR-<repo>`, then `docker compose up -d --build` | To build: a second checkout (e.g. `~/Prod/csp-qa/`) with its own compose project name |
| Traffic | Router NAT → Caddy :80 → frontend :3003 → backend :8003 | To build: its own Caddy route or port |
| Database | MongoDB Atlas, db `bangkoktor` | To build: a separate db (e.g. `bangkoktor_qa`). Never point UAT at production data |
| Workers | macOS launchd: discover at 06:00 and 18:00, ingest worker kept alive (`scripts/schedule/install.sh` in the backend) | Usually not needed |

## How the pieces connect

- Both compose files join the external Docker network `bangkoktor-net`. The
  frontend reaches the backend at `http://backend:8003`. Create the network once
  per machine with `docker network create bangkoktor-net`.
- Neither container publishes a host port; only Caddy is exposed. The Caddy
  config lives outside both repos, in `~/Prod/csp/caddy/`.
- The backend image is `oven/bun:1`, runs as user `bun`, and has a HEALTHCHECK
  on `/health`. The frontend image builds the Next.js standalone server and
  runs it on 3003.

## Known gaps

- Production is plain HTTP, with no TLS yet.
- CI runs no typecheck, tests or lint before deploying.
- Base images are not pinned to a digest.

## Rolling back

Deploy means "whatever is on `main`", so a rollback is a commit on `main`.

1. Find the bad merge: `git log --first-parent main`.
2. Revert it on a branch: `git revert -m 1 <merge-sha>`, then open a PR to
   `main` titled `revert: …`.
3. Get a quick review and merge. The runner redeploys the previous behaviour.
4. If the site is down and you can't wait for a PR, the Mac mini owner runs
   `git checkout <last-good-sha> && docker compose up -d --build` in the
   production folder. Follow up with the revert PR the same day, or the next
   push undoes the fix.

A code revert doesn't undo data changes made by CLI scripts. Run
`bun run backup-collections` (backend) before any script that writes to
production; `restore-from-backup` is the way back.
