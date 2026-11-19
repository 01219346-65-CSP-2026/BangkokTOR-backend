# Environments & deployment

> Shared file, identical in the backend and frontend repos. Change both.

**A merge to `main` in either repo is live in production a few minutes later,
once CI passes — with no manual step.** The UAT environment from our
[git workflow](team/workflow.md) does not exist yet; the right-hand column
below is what has to be built.

| | Production | UAT (`QA`) |
|---|---|---|
| Branch | `main` | `QA`, **not created yet** |
| Trigger | Push to `main` → `.github/workflows/ci.yml`: checks on GitHub-hosted runners, then the `deploy` job on the self-hosted runner on the Mac mini, only if every check passed | To build: the same workflow, triggered on `QA` |
| What the job does | `git pull --ff-only` in `~/Prod/csp/BangkokTOR-<repo>`, then `docker compose up -d --build --wait` (fails the run if a container doesn't come up healthy) | To build: a second checkout (e.g. `~/Prod/csp-qa/`) with its own compose project name |
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
- Base images are not pinned to a digest.

## CI

`.github/workflows/ci.yml` runs on every PR to `main` and every push to it.
Branch protection on `main` requires all four checks before a merge.

| Check | Frontend | Backend |
|---|---|---|
| Static | `lint`: `bun run lint` + `tsc --noEmit` | `typecheck`: `bun run typecheck` |
| `test` | `bun test` | `bun test` against a throwaway `mongo:7` service |
| `build` | `docker build .` (runs `next build`) | `docker build .` |
| `audit` | `bun audit --audit-level=high` | same |

The checks run on GitHub-hosted runners. These repos are public, so PR code
must never run on the self-hosted runner, which can reach production. Only the
`deploy` job, on a push to `main`, runs there. Reproduce a failing check
locally with the command in the table.

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
