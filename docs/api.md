# API reference

The API has **51 endpoints on `main`**, all mounted in `src/routes/index.ts`.
The browser never calls them directly; it calls the frontend's `/api/*` route
handlers, which forward here. The **FE** column marks the endpoints the
frontend uses.

> **Pending:** `GET /api/me` and `users.session_version` arrive with PR #27
> (`patch-05/shorter-session-recheck`). The frontend `main` already calls
> `GET /api/me`.

**Conventions**

- **Auth**: *none* = public · *User* = Bearer internal JWT · *Admin role* = User
  plus `role: admin` · *Admin token* = `X-Admin-Token` header (a wrong token
  returns 404).
- **Paged** responses are `{items, total, page, limit, pages}`; `limit` caps at 100.
- **Errors** are `{error: "message"}`. A bad ObjectId or query value returns 400.
- **Rate limits** are fixed windows held in memory, answering 429 with
  `Retry-After`: *read* 120/min per IP, *pipeline* 60/min per IP, *write*
  20/min per IP, *run* 2/hour per IP, *profile* 60/min per user. The IP is the
  leftmost `X-Forwarded-For`.

When you change a route, update this file in the same PR.

## Health

| Method | Path | Auth | Returns | Purpose |
|---|---|---|---|---|
| GET | `/` | none | `{message}` | Banner showing the API is up |
| GET | `/health` | none | `{status, uptime, timestamp}` | Liveness check; used by the Docker HEALTHCHECK |
| GET | `/health/ready` | none | 200, or 503 with `checks.mongo` | Readiness check: pings Mongo |

## TORs — `/api/tors` (read limit)

Every read is scoped to public TORs: `isSoftware: true`, the current or previous
Thai fiscal year, and a visible status. Responses pass through
`tor.serialize.ts`, which removes the private grade (FR-19).

| Method | Path | Auth | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|---|
| GET | `/api/tors` | none | `q`, `agency`, `category`, `method`, `province`, `stage`, `workType`, `minBudget`, `maxBudget`, `publishedFrom`, `publishedTo`, `sort`, `skills`, `fit`, `bidding` (open,upcoming,closed), `page`, `limit` | Paged PublicTor; with `skills`, adds `fitScore`, `matchedSkillCount` | Search, filter, sort and page the TOR list, optionally scored against skills (FR-12, FR-13) | ✓ |
| GET | `/api/tors/stats` | none | — | Totals plus counts by bidding status, category, method, work type, stage, province | Filter-panel options and counts | ✓ |
| GET | `/api/tors/insights` | none | `province?` | Totals, by method, budget bands, top agencies, by month, by Bangkok district | Dashboard charts and the district map (FR-20) | ✓ |
| GET | `/api/tors/agencies` | none | — | `[{agency, count}]` | Agency filter dropdown | ✓ |
| GET | `/api/tors/preview` | none | `skills`, `minBudget`, `maxBudget`, `seed` | `openCount`, `reachableCount`, `topMatches`, `suggestions`, `nudge` | Skills-wizard preview: what this profile could bid on now | ✓ |
| GET | `/api/tors/:id` | none | `:id` | TOR + `documents[]` + `summaryPoints[]`; 404 | TOR detail page | ✓ |
| GET | `/api/tors/:id/documents/:documentId/file` | none | ids | PDF stream (inline) | Open an extracted PDF; the path is confined to `EXTRACT_DIR` (FR-05) | ✓ |
| GET | `/api/tors/:id/similar` | none | `:id` | `{items}`: top 3 with similarity ≥ 10 | Similar TORs (FR-14) | ✓ |
| GET | `/api/tors/:id/advisory` | User (profile limit) | `:id` | `{level 1–3 or null, patternCount, phases[findings]}` | Neutral legitimacy advisory, no letter grade (FR-18–20) | ✓ |
| GET | `/api/tors/:id/grade` | Admin token | `:id` | `{grade, gradeScore, findings[evidence]}` | Full private grade with evidence | |

Allowed values are defined in `src/modules/tor/tor.model.ts`.
`sort`: `mostTimeLeft` (default), `closingSoon`, `newest`, `oldest`,
`budgetHigh`, `budgetLow`, `bestMatch`. `fit`: `strong`, `moderate` or `weak`,
and needs `skills`.

## Budget — `/api/budget` (read limit)

| Method | Path | Auth | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|---|
| GET | `/api/budget/insights` | none | `year?` (BE 2560–2600) | `{imported:false}`, or totals, agencies, upcoming lines, timing | Bangkok's software budget for a year vs the TORs that spent it | ✓ |

## Signed-in user — `/api/me` (User on every route, profile limit)

The user id always comes from the token, never from the request (NFR-08).

| Method | Path | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|
| GET | `/api/me/profile` | — | Profile, or **204** if never saved | Read the skill profile | ✓ |
| PUT | `/api/me/profile` | `skills[]`, `team_size_band`, `duration`, `concurrent` (1–50), `budget_min`, `budget_max`, `notify{on_match, only_strong_fit, include_signals}`, `work_types[]?` | Profile; 400 on unknown skills | Replace the whole profile (FR-15) | ✓ |
| GET | `/api/me/bookmarks` | — | `{items: PublicTor + bookmarkedAt}` | Saved TORs, newest first | ✓ |
| GET | `/api/me/bookmarks/:torId` | — | `{bookmarked}` | Is this TOR saved? | ✓ |
| PUT | `/api/me/bookmarks/:torId` | — | 204; 404 if no such TOR | Save a TOR; safe to repeat | ✓ |
| DELETE | `/api/me/bookmarks/:torId` | — | 204 | Remove a saved TOR; safe to repeat | ✓ |
| GET | `/api/me/notifications` | `limit?` (1–100, default 50) | `{items}` | Notification feed, newest first (FR-16) | ✓ |
| PATCH | `/api/me/notifications/:id/read` | — | Notification; 404 if not the caller's | Mark one as read | ✓ |

## Users — `/api/user` (write limit)

| Method | Path | Auth | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|---|
| POST | `/api/user/sync` | Admin token | `google_id`, `email` (required); `email_verified`, `name`, `given_name`, `family_name`, `avatar_url` (https), `locale` | 201 created / 200 updated | Create or update the user on Google sign-in (FR-01) | ✓ |
| GET | `/api/user` | Admin role | `page`, `limit`, `sort`, `email?`, `role?` | Paged users | Admin user list | |
| POST | `/api/user` | Admin token | `email`, `google_id?`, `profile?` | 201; 409 on duplicate | Create a user (`role` can't be set) | |
| GET | `/api/user/:id` | Admin role | — | User; 404 | One user | |
| PATCH | `/api/user/:id` | Admin token | `email?`, `profile?` (`role` → 400) | User; 409 | Update a user | |
| DELETE | `/api/user/:id` | Admin token | — | 204; 404 | Delete a user | |

## Notifications (admin) — `/api/notification` (write limit, Admin token on every route)

| Method | Path | Input | Returns | Purpose |
|---|---|---|---|---|
| GET | `/api/notification` | `page`, `limit`, `sort`, `user_id?`, `tor_id?`, `is_read?` | Paged | Admin list |
| POST | `/api/notification` | `user_id`, `title` (≤200), `tor_id?`, `message?` (≤2000), `matched_at?` | 201; 409 for a duplicate user+TOR | Create by hand |
| GET | `/api/notification/:id` | — | Notification; 404 | Read one |
| PATCH | `/api/notification/:id` | `title?`, `message?`, `is_read?` | Notification | Edit (`user_id` is fixed) |
| DELETE | `/api/notification/:id` | — | 204 | Delete |

## Tech stacks — `/api/techstack` (write limit)

| Method | Path | Auth | Input | Returns | Purpose |
|---|---|---|---|---|---|
| GET | `/api/techstack` | none | `page`, `limit`, `sort`, `search?` (name prefix) | Paged `{id, name, slug, category}` | The skill vocabulary |
| GET | `/api/techstack/:id` | none | — | Tech stack | Read one |
| POST | `/api/techstack` | Admin token | `name` (≤80), `slug?`, `category?` | 201; 409 | Add a skill |
| PATCH | `/api/techstack/:id` | Admin token | `name?`, `slug?`, `category?` | Tech stack | Edit a skill |
| DELETE | `/api/techstack/:id` | Admin token | — | 204 | Remove a skill |

## Pipeline triggers — `/api/ingest`, `/api/extract`, `/api/grade`

| Method | Path | Auth / limit | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|---|
| POST | `/api/ingest/run` | Admin token, run | `{limit?, resume? = true}` | 202 | Start discovery in the background; feeds set by `EGP_FEED` (FR-04) | |
| GET | `/api/ingest/status` | pipeline | — | Queue counts, watermark, latest run, recent errors | Ingest health | |
| POST | `/api/ingest/capture` | Admin token, write, 2 MB body | `{projects: [{projectId (11 digits), title?, agency?, province?}] (≤2000), source?}` | `{runId, received, enqueued, alreadyHeld, invalid, alreadyQueued}` | Queue e-GP projects from the capture extension or the admin CSV import | ✓ |
| POST | `/api/extract/run` | Admin token, run | `{limit?}` | 202 | Queue downloaded bundles for extraction | |
| GET | `/api/extract/status` | pipeline | — | Queue, `tor_texts`, digital vs scanned split, recent results | Extraction health | |
| POST | `/api/grade/run` | Admin token, run | `{limit? = 5}` | 202 | Grade up to N TORs inside the API process | |
| GET | `/api/grade/status` | pipeline | — | `{grades{A,B,C}, graded, awaitingGrade, graderVersion}` | Grading progress | |

## Admin monitor — `/api/pipeline` (pipeline limit, Admin role on every route)

| Method | Path | Extra | Input | Returns | Purpose | FE |
|---|---|---|---|---|---|---|
| GET | `/api/pipeline/status` | — | — | Mongo state, stage counts, claim age, latency, errors by kind, workers (live/stale/dead), TOR status counts | Everything `/admin/pipeline` shows | ✓ |
| GET | `/api/pipeline/queue` | — | `stage` (ingest/extract), `status?`, `page`, `limit` | Paged queue rows | Browse a queue | ✓ |
| GET | `/api/pipeline/runs` | — | `limit?` (default 20) | `{items}` | Run history | ✓ |
| POST | `/api/pipeline/workers/stop` | write + Admin token | `{ids: string[1..100]}` | `{flagged}` | Ask workers to stop after their current row | ✓ |
| POST | `/api/pipeline/workers/flush` | write + Admin token | — | `{removed}` | Delete heartbeats of dead workers | ✓ |
| POST | `/api/pipeline/errors/:id/retry` | write + Admin token | `:id` (ingest_errors) | `{projectId, status}`; 409 for oversize errors | Put a failed row back to pending | ✓ |

There is no OpenAPI spec or Postman collection yet; this file is the contract.
