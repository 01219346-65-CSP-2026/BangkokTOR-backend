# BangkokTOR docs

Start here. In about 15 minutes you'll know how the system fits together, how
to run it, and how the team ships a change.

BangkokTOR collects software-related Thai government procurement TORs,
structures them, matches them to dev teams by skill profile, and flags tenders
that look unfair, always in advisory wording (FR-19). The requirements are in
the SRS (`CSP project v2.pdf`, FR-01 to FR-24, NFR-01 to NFR-10).

## Read in this order (≈15 min)

| # | File | Time | You'll know |
|---|---|---|---|
| 1 | [architecture.md](architecture.md) | 4 min | The parts, how a request flows, the pipeline |
| 2 | [setup.md](setup.md) | 3 min | How to run the API and workers locally |
| 3 | [team/workflow.md](team/workflow.md) | 3 min | Branches, `QA` → `main`, hotfixes |
| 4 | [team/process.md](team/process.md) | 2 min | Sprint loop, how to create and do a task |
| 5 | [team/pull-requests.md](team/pull-requests.md) | 3 min | Commit messages, PR template, Definition of Done |

## Reference (look things up when you need them)

| File | What |
|---|---|
| [api.md](api.md) | Every endpoint: method, path, auth, input, output, purpose |
| [data-model.md](data-model.md) | Mongo collections, keys, the TOR status lifecycle |
| [deployment.md](deployment.md) | Environments, how a merge deploys, rollback |
| [team/glossary.md](team/glossary.md) | TOR, FR, UAT, BE year, watermark… |
| [learning/](learning/) | Vertex key setup and a syntax cheat sheet |

## The two repos

| Repo | What | Port |
|---|---|---|
| [BangkokTOR-backend](https://github.com/01219346-65-CSP-2026/BangkokTOR-backend) (this one) | Express 5 API, ingestion and AI workers, MongoDB models | 8003 |
| [BangkokTOR-frontend](https://github.com/01219346-65-CSP-2026/BangkokTOR-frontend) | Next.js 16 web app plus its server-side API proxy | 3003 |

The frontend repo has its own `docs/` covering pages and auth. Files under
`team/` and `deployment.md` are the same in both repos; if you change one,
change both.

> The repo-root `README.md` and `AGENTS.md` are partly out of date about the API
> (e.g. Ollama, `tor_chunks`, an `isSoftware` filter). Where they disagree with
> these docs, the code and these docs win.
