# Pull requests & reviews

> Shared file, identical in the backend and frontend repos. Change both.

**A PR merges when one teammate other than the author approves it and the
Definition of Done below is met.** `main` deploys on every push and CI runs no
tests, so review is our only gate.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org):
`<type>(<scope>): <what changed, present tense>`.

| Good | Why |
|---|---|
| `feat(tor): hide open TORs with no readable deadline` | Type, area and the behaviour change |
| `fix(skills): tag TOR skills from stored full text, not title only` | What was wrong and what happens now |

| Avoid | Write instead |
|---|---|
| `implemented rbac` | `feat(auth): add admin role check on /api/pipeline` |
| `feat: passed all A1-4 Test case` | Say what behaviour works now, not that tests pass |
| `feat:made backend for email notifciations` | `feat(notify): send match digest emails` |

- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.
- **Scopes:** the module or area, e.g. `tor`, `me`, `user`, `ingest`, `extract`,
  `grade`, `pipeline`, `budget`, `auth`, `ui`.

## Opening a PR

- **Title:** `SCRUM-123: <what it does>`
- **Base branch:** `QA` first, then `main` after UAT. Only a hotfix goes
  straight to `main`.
- **Size:** keep it under about 400 changed lines. A bigger ticket should
  usually be split.
- **Description:**

```markdown
## What
One or two sentences on the change.

## Why
Jira: SCRUM-123 · FR-13

## How to test
1. Steps a reviewer can follow locally
2. Expected result

## Screenshots
(UI changes only)

## Checklist
- [ ] Acceptance criteria met
- [ ] typecheck and tests pass locally
- [ ] docs/ updated (API table, env vars, setup) if affected
- [ ] No secrets or .env values in the diff
```

## Reviewing

- Review within **one working day**, or within the hour for a hotfix.
- Pull the branch and run it if it changes behaviour. Reading the diff isn't
  enough for UI or auth changes.
- Check that:
  - every acceptance criterion is met;
  - no private field is exposed (FR-19);
  - the user id comes from the token, not the request (NFR-08);
  - errors are handled.
- Use **Request changes** for anything that blocks the merge. Prefix optional
  remarks with `nit:`.
- The author pushes the fixes, resolves the threads and re-requests review.

## Definition of Done

- [ ] Every acceptance criterion on the ticket is met and shown under "How to test"
- [ ] Typecheck, tests and lint pass locally (see `docs/setup.md`)
- [ ] New logic has at least one test (`bun test`; branch checks in `checklist/`)
- [ ] One approval from someone other than the author
- [ ] Passed UAT on `QA` (not needed for a hotfix)
- [ ] `docs/` updated: API table, `.env.example`, setup steps
- [ ] No leftover `TODO`s, debug logs or commented-out code
- [ ] Jira ticket moved to Done; branch deleted
