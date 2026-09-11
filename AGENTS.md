# BangkokTOR — backend

Read this before writing any code in this repo. It covers what the product is, why it
exists, how this codebase is arranged, and which decisions are still open.

The authoritative requirements document is the SRS: `CSP project (6).pdf` in this
directory (v0.1 draft, 19 pages). Requirement IDs used below — `FR-XX`, `NFR-XX`,
`UC-XX`, `US-XX` — are its IDs. When a task references one, read that section of the
SRS rather than guessing what it means.

---

## 1. What the product is

**BangkokTOR aggregates Thai government procurement TORs and matches them to software
teams by skill profile.**

A **TOR** (Terms of Reference) is a document a government agency publishes describing a
project it wants to hire an outside team for — scope, budget, deadline, and the
qualification criteria a bidder must meet. Thai agencies are legally required to publish
these. In practice they land on several independently-run portals, in Thai, mostly as
scanned PDFs, with no search worth the name. The work is legally public and practically
undiscoverable without an inside contact at the publishing agency.

The platform does three things about that:

1. **Ingests** TORs on a schedule from Bangkok government procurement portals and stores
   the source PDF plus a link back to the original listing.
2. **Extracts and classifies** — structured fields out of the documents (including Thai
   and scanned ones), and a software-vs-not classification so the dashboard shows only
   software/IT tenders.
3. **Matches and flags** — matches new TORs against registered teams' skill profiles and
   notifies them, and detects red-flag patterns in a TOR's qualification section that
   suggest it was written to favour a predetermined vendor.

### The legitimacy-flagging rule — read this before touching that feature

Legitimacy signals are **advisory, never accusatory** (FR-19). A response, a field name,
an email body, a log line: none of them may assert that a TOR *is* rigged, fraudulent, or
corrupt. The vocabulary is "shows N patterns worth scrutinizing", with the specific
reasons listed. Detecting zero signals is a result to report explicitly ("no red-flag
patterns detected"), not an empty field.

This is not stylistic. Publicly labelling a named government agency's tender as
suspicious carries real reputational and legal exposure, and the SRS lists the final
wording as an open issue (SRS §7.2). Do not soften-then-strengthen it on your own
initiative. If an API shape you're designing would let a client render an accusation,
change the shape.

### Users and permissions

| Class | Can |
|---|---|
| **Guest** (unauthenticated) | Browse and search the public TOR dashboard. Nothing else. Attempts at profile/notification routes get bounced to login (FR-02). |
| **Registered Team** | Everything a guest can, plus: skill profile CRUD, matching, notifications, legitimacy signals on a TOR. |
| **Admin** | Everything a team can, plus: source-portal management and platform statistics (FR-03, FR-07, FR-21). |

Note the asymmetry that trips people up: **browsing does not require auth, personalization
does.** Don't put the whole API behind a session guard.

### Explicitly out of scope for this phase

Bid submission, non-software procurement, anything outside Bangkok, monetization/billing,
mobile, and taking legal action on a user's behalf. If a task seems to need one of these,
stop and ask — it's more likely a misread than a scope change.

---

## 2. Non-negotiable requirements that constrain backend design

These come straight from the SRS and shape code you'd otherwise write differently:

- **Never fail silently** (FR-06, FR-11, NFR-06). A portal layout change, an unreachable
  source, an AI service outage, a PDF that won't parse — each is logged and surfaced to
  the admin panel. A TOR whose required fields could not be confidently extracted is
  marked `extraction incomplete` and held out of the public dashboard; it is never
  published with partial or invented data.
- **One broken portal must not break the others** (UC-01 alt-flow a). Ingestion is
  per-source and isolated.
- **Distinguish failure kinds** (FR-24). "The source document is malformed" and "the AI
  service is down" are different errors with different user-facing text and different
  retry semantics. Don't collapse them into one 500.
- **Queue the slow work** (NFR-01). Scraping and AI extraction must not block dashboard
  availability. Requests never wait on an extraction.
- **At least daily re-check** of every configured source (NFR-02).
- **Scope every query to the authenticated user's ID by default** (NFR-08). IDOR is called
  out by name in the SRS. A service function that takes an `id` and no owner is a bug
  waiting to be filed.
- **Respect each portal's ToS and rate limits** (NFR-07). Real delay between requests, an
  honest `User-Agent` with a contact address, no hammering.

---

## 3. The data sources

**Decided (2026-09-03): two sources, behind one adapter interface.** Neither is "the"
source. `egp2.bangkok.go.th` covers BMA agencies with a clean per-document API;
`opend.data.go.th` + `process5.gprocurement.go.th` covers national e-GP with richer
contract fields but no server-side filtering. Both are verified live. The architecture in
§4 makes them two implementations of one `Source` port, so UC-01's "one broken portal must
not break the others" is structural rather than a promise.

| | **A — BMA e-GP** `egp2.bangkok.go.th` | **B — CKAN → national e-GP** |
|---|---|---|
| Auth | none | `DATAGOTH_KEY` (CKAN only; e-GP side none) |
| Discovery | paged JSON search, TOR filtered server-side | bulk pull 511,606 rows, filter **client-side** |
| Documents | one PDF per announcement | one zip bundle per project |
| Coverage | BMA only — 68 agencies, 4,854 TOR projects, 2018→ | national |
| Extra fields | — | winner, tax id, contract dates, coordinates |
| Reference impl | `../testTOR/bangkoktor_ingest.py` (Python) | `../testTOR/reference-ts/` (TypeScript) |

Both reference implementations are **evidence, not dependencies**. They are archived
outside `src/` deliberately: the code in this repo is being rebuilt file by file, and the
archive exists so hard-won live-API findings (below) are not rediscovered, not so they can
be copied in wholesale.

### Source A — the BMA e-GP API

Base `https://appapi` host `https://egp2.bangkok.go.th/appapi/api`, files on
`https://egp2.bangkok.go.th/api/file`.

| Call | Purpose |
|---|---|
| `GET /Projects/GetProjectFromFilter` | Paged project search. Params: `projectSearchText`, `masterAnnounceTypeId`, `startDate`, `endDate`, `pageNo`, `pageSize`, `sortBy`. Returns `totalCount`, `hasNextPage`, `data[]`. |
| `GET /Projects/GetProjectDetail?projectId=` | Structured fields for one project. |
| `GET /ProjectAnnouncements/GetAnnouncementDetailInProject?projectId=&pageNo=&pageSize=` | The documents attached to a project. |
| `GET /api/file/{announcementId}/{urlencoded filename}` | **The PDF itself.** |

**The PDF line, exactly:**

```
https://egp2.bangkok.go.th/api/file/{announcement.id}/{encodeURIComponent(announcement.projectAnnouncementPath)}
```

`projectAnnouncementPath` is the filename and is **Thai text** — it must be percent-encoded.
An announcement with a null `projectAnnouncementPath` has no file attached; record that as
an ingest error (FR-11), don't drop it. Verified live: returns real `%PDF` bytes, 0.9–6.7 MB
per document, no auth header needed.

TORs are `masterAnnounceTypeId = 24995aa2-d875-4d3d-9dec-d5e22d222aa4` (ร่างขอบเขตของงาน).
A project usually carries several document types worth storing — ร่างขอบเขตของงาน (TOR),
ประกาศราคากลาง, ประกาศเชิญชวน, ร่างเอกสารประกวดราคา.

### Coverage — what this portal does and does not contain

Measured live against the API on 27 Aug 2026:

- **270,858 projects total; 4,854 have a TOR document.** The TOR subset is the ingestion
  target — a scrape of ~4.9k projects, not 270k.
- **68 distinct agencies, and every one is a BMA body.** All 50 district offices
  (สำนักงานเขต) plus the BMA bureaus (สำนักการแพทย์ 1,320, สำนักสิ่งแวดล้อม 273,
  สำนักการโยธา 113, สำนักดิจิทัลกรุงเทพมหานคร 44, …).
- **Coverage runs from roughly 2018 to the present** (oldest project number `61107027488`).

**This is the important limitation: `egp2` is the Bangkok Metropolitan Administration's own
portal. It covers BMA agencies only.** Ministries, state enterprises, universities, and
other national agencies that happen to be located in Bangkok publish to the national e-GP
(`gprocurement.go.th`) and do not appear here. So this source covers *Bangkok city
government* procurement, which is narrower than "all TORs in Bangkok". The SRS's KU
motivating case is exactly the sort of tender that would **not** be in this dataset.

Say "BMA procurement" in user-facing copy rather than implying full Bangkok coverage. If
full coverage is a requirement, a second source is needed — `gprocurement.go.th` is
unspiked, and the SRS is internally inconsistent about the third source (§1.5/§4.1 say
`procurement.nsm.or.th`, §7.1 says `opend.data.go.th`). The `../testTOR/egp.py` script
explores the `opend.data.go.th` CKAN gateway, which carries national e-GP data but exposes
no server-side filtering and mangles Thai query params.

### Known API defects — design ingestion around these

- **The date filter does not work.** Passing both `startDate` and `endDate` returns
  **HTTP 500** in every format tried (`YYYY-MM-DD`, ISO 8601, Buddhist-era). Passing only
  one returns 200 but is **silently ignored** — `startDate=2030-01-01` still reports all
  4,854 records. The spike's `--from-date` / `--to-date` flags therefore do nothing.
  **Incremental "what's new since yesterday" ingestion cannot be done server-side.** Page
  `sortBy=publishDateDesc` and stop when you reach project ids you already have.
- **`sortBy` fails open.** An unrecognized value returns 200 with default ordering rather
  than an error. Only `publishDateAsc` / `publishDateDesc` were observed to change results.
- **`GetProjectDetail` returns no date field at all** — no publish date, no closing
  deadline. The only date available is `projectAnnouncementPublishDate` on each
  announcement. **FR-13 requires filtering by deadline; the portal does not supply one.**
  Either derive it from the announcement publish date, extract it from the PDF, or take
  the requirement back to the SRS. Do not invent a deadline field.

### Source B — CKAN → national e-GP

A two-hop chain, verified live. The join key is the whole trick: CKAN's `รหัสโครงการ`
**is** the e-GP `projectId`, so a bulk open-data pull gives you discovery and e-GP gives
you the documents.

```
opend.data.go.th/get-ckan/datastore_search   →  รหัสโครงการ (== projectId)
process5.gprocurement.go.th/egp-approval-service/apv-common/infoProcureDocAnnounZipTemp?projectId=…
                                             →  zipId
process5.gprocurement.go.th/egp-upload-service/v1/downloadFileTest?fileId=<zipId>
                                             →  zip of PDFs
```

Verified resource `e4eaa1b4-eb1a-4534-b227-988ee25b898d`, 511,606 rows. Page size 32,000;
larger values are silently clamped.

**Its defects, each of which has bitten and must be designed around:**

- **No `datastore_search_sql`, and non-ASCII query params are mangled** (`q=ซอฟต์แวร์`
  arrives as `?????`). Together: *all* Thai filtering happens client-side, after a bulk
  pull. There is no such thing as a server-side search on this source.
- **Rows are shifted against their header — real, confirmed on this resource.** The API
  declares 32 columns; each row carries 29 values. The three `(Eng)` columns are declared
  and never populated, so the gateway zips 29 values against 32 keys and every column after
  the first phantom lands under the wrong name:

  | declared column | actually holds |
  |---|---|
  | `แขวง/ตำบล` | `"POINT(102.8 16.4)"` |
  | `สถานะโครงการ` | `102.82574415207` (a longitude) |
  | `ละติจูดโครงการ` | `"กิจการร่วมค้า ช.ทวี…"` (a company name) |

  Reading these at face value **files a company name as a latitude**. Columns up to and
  including `จังหวัด` (index 15) are unaffected. Detect the shift, re-zip values against
  the header with the phantom columns removed, and leave unshifted rows untouched — a
  resource without the defect must not be corrupted by "fixing" it.
- **The bundle download has no `content-length` header.** Verified bundles run from ~1MB
  to 512,452,129 bytes. There is nothing to pre-check, so the size cap must be enforced by
  counting bytes as they stream, and the write must stream to disk — `await
  response.arrayBuffer()` on one of these puts half a gigabyte in the worker heap.
- **A 200 response is not necessarily a zip.** A government host returning an HTML error
  page or a WAF challenge with a 200 is a real, observed failure mode. Check the first four
  bytes for `PK\x03\x04` and abort early rather than discovering it at unzip time.
- **Most projects have no bundle at all** — `responseCode "1"` / `E0001`. This is the
  expected majority outcome and is *data, not an error*. Surfacing it as a failure would
  drown the admin panel (FR-07) in noise about projects that are perfectly fine.

### What the API gives you free, and what actually needs AI

`GetProjectDetail` returns, already structured: `projectName`, `masterOrgGroupName`
(agency), `masterOrgDepartmentName`, `projectBudget`, `projectAverageBudget` (ราคากลาง),
`masterMethodIdName` (procurement method), `masterTypeIdName`, `masterGoodsIdName` (goods
category), `masterContractAvailableName` (status).

The SRS assumed all of this had to be AI-extracted from PDFs (FR-08). It does not.
**Do not build a PDF-extraction pipeline for fields the API already serves.**

What genuinely needs AI or OCR:

- the **qualification section** — unstructured, exists only inside the PDF;
- the **required-skills** list;
- **software-vs-not classification** (FR-10);
- **legitimacy signals** (FR-18).

On classification: `masterGoodsIdName` is a coarse pre-filter at best. Across the sampled
TOR projects it is dominated by วัสดุครุภัณฑ์วิทยาศาสตร์และการแพทย์ and จ้างเหมาอื่นๆ,
with only a couple in วัสดุครุภัณฑ์คอมพิวเตอร์ — and that computer category is mostly
hardware purchases, not software development. A naive title keyword scan
(ซอฟต์แวร์/สารสนเทศ/คอมพิวเตอร์/ดิจิทัล/…) matches 264 of 4,854 TOR projects (5.4%), but
inspection shows most of those are medical imaging and office-supply buys. **The genuine
software-development TOR count is well under 5% and the classifier is doing real work** —
this is the firehose FR-10 exists to filter. Budget expectations accordingly: this is a
low-hundreds dataset per year, not thousands.

### OCR reality

In the spike's 50-record sample, TOR documents were **69% scanned / 27% digital / 4%
announced-but-no-file**. OCR is the main path, not the fallback (FR-09). (The docstring in
`bangkoktor_ingest.py` claims ~93% scanned; the measured manifest says 69% — trust the
manifest, and re-measure on a larger sample before pricing OCR.) The spike tags each
document `digital` / `scanned` / `unreadable` so extraction can route without
re-downloading.

### Politeness

No auth means the only thing owed the portal is courtesy, and NFR-07 makes it a
requirement: honest `User-Agent` with a contact address, ~0.4s between requests,
exponential backoff on failure. The spike's `Client` class is the reference implementation.

---

## 4. Ingestion architecture

Scope of this section: **ingest → store → serve.** Extraction, OCR, classification,
matching and legitimacy signals are shown only as the boundary they hand off across; they
are designed later and deliberately not designed here.

### 4.1 The shape

Five stages. Each hands the next a row in Mongo, never a function call — that is what lets
a stage crash, retry, or be re-run without the others noticing.

```
                    ┌─────────────────────────────────────────────┐
                    │  SCHEDULER          daily, per source        │
                    │  (NFR-02)           writes an IngestRun row  │
                    └──────────────────────┬──────────────────────┘
                                           │
                    ┌──────────────────────▼──────────────────────┐
   ADAPTER LAYER    │  Source port:  discover() → listDocs() →     │
   one per portal   │                fetchDoc()                    │
                    │  ┌───────────────┐    ┌──────────────────┐   │
                    │  │ egp2 adapter  │    │ ckan+egp adapter │   │
                    │  │ (BMA)         │    │ (national)       │   │
                    │  └───────┬───────┘    └────────┬─────────┘   │
                    └──────────┼─────────────────────┼─────────────┘
                               │   politeFetch: UA, delay, backoff
                               │   (NFR-07 — the ONLY way out to a gov host)
                    ┌──────────▼─────────────────────▼─────────────┐
      ①  DISCOVER   │  page listings → raw source rows             │
                    │  dedupe on (source, projectId)               │
                    └──────────────────┬──────────────────────────┘
                                       │  upsert
                    ┌──────────────────▼──────────────────────────┐
      ②  NORMALIZE  │  source row → canonical Tor fields           │
                    │  Thai dates, BE→CE, THB integers, geo        │
                    │  pure functions — no I/O, testable on a      │
                    │  fixture with no database                    │
                    └──────────────────┬──────────────────────────┘
                                       │  Tor{ status: discovered }
                    ┌──────────────────▼──────────────────────────┐
      ③  FETCH DOCS │  download PDFs / zip bundles to blob store   │
                    │  sha256, size cap, magic-byte check          │
                    │  .part → rename (never a truncated file      │
                    │  that looks complete to the next run)        │
                    └──────────────────┬──────────────────────────┘
                                       │  Document{ textLayer: ? }
                    ┌──────────────────▼──────────────────────────┐
      ④  TRIAGE     │  digital | scanned | unreadable | missing    │
                    │  routes the OCR bill before it is incurred   │
                    └──────────────────┬──────────────────────────┘
                                       │
             ═══════════════════════════╪═══════════════════ handoff boundary
                                       │   (out of scope here)
                    ┌──────────────────▼──────────────────────────┐
                    │  EXTRACT · OCR · CLASSIFY · MATCH · FLAG     │
                    └──────────────────┬──────────────────────────┘
                                       │  Tor{ status: published }
                    ┌──────────────────▼──────────────────────────┐
      ⑤  SERVE      │  read-only API over Mongo. Never waits on    │
                    │  ingestion (NFR-01). Guest-readable.         │
                    └─────────────────────────────────────────────┘
```

### 4.2 The Source port — the one abstraction that earns its keep

Three methods. Everything portal-specific lives behind them, and the pipeline above never
learns which portal it is talking to.

```ts
type Source = {
  readonly id: string;                    // "egp2" | "ckan-egp"
  discover(cursor: Cursor): AsyncIterable<RawProject>;
  listDocuments(projectId: string): Promise<RawDocument[]>;
  fetchDocument(doc: RawDocument, dest: string): Promise<FetchOutcome>;
  normalize(raw: RawProject): CanonicalTor;
};
```

Why these three and not more: they are the only operations both portals genuinely share.
`discover` is paged search on A and a bulk scan on B; `listDocuments` is an announcements
call on A and a bundle probe on B; `fetchDocument` is a direct PDF GET on A and a streamed
zip + unzip on B. Anything that differs beyond that — zip magic bytes, phantom-column
realignment — is *inside* an adapter and must never leak into the pipeline. If you find
yourself adding an `if (source.id === …)` outside an adapter, the port is wrong, not the
code.

`FetchOutcome` is a **discriminated union, not a throw**, because FR-24 requires
distinguishing failure kinds and the majority "failure" is not one:

```ts
type FetchOutcome =
  | { ok: true; bytes: number; sha256: string; path: string }
  | { ok: false; reason: "no-bundle" }      // expected. data, not an error.
  | { ok: false; reason: "oversize"; bytes: number }
  | { ok: false; reason: "not-a-zip" }      // HTML error page / WAF challenge
  | { ok: false; reason: "no-file-attached" }; // FR-11: announced, nothing there
```

### 4.3 Collections

Six. Named here so the shape is settled before anyone writes a schema; the fields are
indicative, not final.

| Collection | Holds | Key indexes |
|---|---|---|
| `sources` | one row per configured portal: id, base URL, enabled, delay, last run. Admin-managed (FR-03, FR-21). | `id` unique |
| `ingest_runs` | one row per scheduled pass per source: started, finished, counts by outcome, errors[]. **This is the admin panel's data** (FR-07). | `sourceId + startedAt` |
| `tors` | the canonical document. Source fields + provenance + status. | `sourceId+projectId` unique; `agency`; `announcedAt`; `budget`; `status+isSoftware` |
| `documents` | one row per PDF: torId, kind, url, sha256, bytes, `textLayer`, localPath. | `torId`; `sha256` |
| `ingest_errors` | every failure, typed and attributable. Never a swallowed catch. | `runId`; `sourceId+kind` |
| `watermarks` | per-source resume state — last seen projectId, last offset, last full-scan time. | `sourceId` unique |

**`watermarks` exists because neither source supports incremental queries.** On A the date
filter is broken; on B there is no filter at all. So "what's new" is *your* state, not the
portal's: page `publishDateDesc` and stop at a known id (A), or diff a full scan against
what you hold (B). This is the single most important consequence of §3's defects — do not
design as if the source can tell you what changed.

### 4.4 Status lifecycle

One field on `tors`, and the public dashboard reads exactly one value of it.

```
discovered ──> documents_fetched ──> extraction_pending ──> published
     │                 │                      │
     └── error ────────┴──────────────────────┴──> extraction_incomplete
                                                    (held back, FR-11 — never
                                                     published with partial or
                                                     invented data)
```

`published` is the only status the guest dashboard serves. `extraction_incomplete` is
visible to admins with its reason attached. Nothing is ever published with a field the
pipeline guessed.

### 4.5 Rules that fall out of this

- **`politeFetch` is the only door out.** Every request to a government host goes through
  one wrapper carrying the honest UA, the inter-request delay, the timeout and the backoff
  (NFR-07). Never inline a `fetch` or a User-Agent at a call site.
- **Normalizers are pure.** Source row in, canonical fields out, no I/O, no model import.
  That is what makes them checkable against a saved fixture, which matters enormously for
  the phantom-column defect — that bug is invisible except in a test that asserts a
  latitude is a number.
- **Per-source isolation is enforced by the loop, not by discipline.** One adapter throwing
  ends that source's run and writes its `ingest_run` row; the others keep going (UC-01
  alt-flow a).
- **Ingestion never runs in a request.** Services take plain arguments and return plain
  data so a scheduler or queue worker calls them directly (§6). No ingestion code sees
  `req` or `res`.
- **Money is THB integers. Dates are stored CE, converted at the adapter edge** — Thai
  sources serve Buddhist-era years, and a BE year that reaches Mongo is 543 years of
  silent wrong.
- **Provenance on every row.** `source`, `sourceUrl`, `fetchedAt`, `sha256`. A TOR the user
  cannot trace back to the original listing is not publishable.

### 4.6 Build order

Each step is a file or two, checkable on its own before the next depends on it.

1. `lib/http/politeClient.ts` — UA, delay, timeout, backoff, typed `HttpError`. Everything
   else calls it.
2. `lib/thai/buddhistDate.ts` — BE→CE dates, Thai numerals, THB parsing. Pure, fixture-testable.
3. `lib/sources/types.ts` — the `Source` port and `FetchOutcome`. No implementation.
4. `lib/sources/egp2/*` — adapter A: discover, listDocuments, fetchDocument, normalize.
5. `modules/tor/*` — model, service, route. Serve what A produced.
6. `modules/ingest/*` — the run loop, watermarks, `ingest_runs`, error recording.
7. `lib/sources/ckan/*` — adapter B, **including the phantom-column realignment and the
   streaming size cap.** Second, so the port is already proven by A.
8. Scheduler wiring (NFR-02) and the admin stats route (FR-07).

Steps 1–5 give a working dashboard on one source. Nothing before step 7 needs an API key.

---

## 5. This codebase

Bun + Express 5 + Mongoose 9, TypeScript strict. Deployed by Docker Compose on a
self-hosted GitHub Actions runner on push to `main`.

```
index.ts                    entry — calls start(), exits nonzero on failure
src/
  app.ts                    express wiring; middleware ORDER lives here
  server.ts                 connect mongo → listen → SIGINT/SIGTERM graceful shutdown
  bun-shims.ts              bson/v8-snapshot shim, preloaded via bunfig.toml
  config/env.ts             env parsing; required() throws at boot on a missing var
  db/mongo.ts               connection, mongoState(), pingMongo()
  middleware/errors.ts      HttpError, notFound, errorHandler
  routes/index.ts           root router — mount feature routers HERE
  routes/health.route.ts    /health (liveness), /health/ready (pings mongo, 503 if down)
  modules/_template/        the canonical module pattern — see below
```

Nothing beyond health checks exists yet. Every feature in §1 is unbuilt, and §4 is the plan for building the ingest half of it.

### Commands

```sh
bun run dev          # watch mode, port 8003
bun run start
bun run typecheck    # tsc --noEmit — must pass before you call anything done
docker compose up -d mongo   # local mongo on 127.0.0.1:27017
```

There is **no test runner and no linter configured yet.** `bun run typecheck` is the only
automated gate. Don't claim a change is verified on the strength of it compiling — say
what you actually ran.

### Environment

`MONGODB_URI` is required and the process refuses to boot without it. Everything else has
a default (`PORT` 8003, `MONGODB_DB_NAME` `bangkoktor`, `NODE_ENV` development,
`MONGOOSE_DEBUG` false). Add a new var in **both** `src/config/env.ts` and `.env.example`;
`.env` is gitignored and must stay that way. Production storage is MongoDB Atlas.

---

## 6. Module pattern — copy `src/modules/_template/`

Every feature is a folder under `src/modules/` with five files, mounted from
`src/routes/index.ts`. The template is the canonical reference; read all five files before
writing your first module.

| File | Owns | Must not |
|---|---|---|
| `*.route.ts` | method + path → handler, and per-route middleware | contain logic |
| `*.controller.ts` | pull input, call **one** service function, pick a status code | query, branch on business rules, or `try/catch` |
| `*.service.ts` | business logic; the **only** layer that touches the model | see `req` or `res` |
| `*.validation.ts` | `unknown` → typed, or throw `HttpError(400, …)` | be skipped for "internal" callers |
| `*.model.ts` | schema, indexes, inferred types | know anything about HTTP |

Rules that follow from that split:

- **Services take plain arguments and return plain data.** That is what makes them callable
  from a cron job, a queue worker, or a seed script — which this project will need for
  ingestion, matching, and notification. A service that reaches for `req` has to be
  rewritten the day it's called from a scheduler.
- **Throw `HttpError(status, message)`.** Express 5 forwards rejected async handlers to
  `errorHandler` on its own — no `try/catch` in controllers, no `next(err)` plumbing.
  In production, non-`HttpError` throws are flattened to "Internal server error", so
  anything the client needs to act on must be an `HttpError`.
- **Serialize `_id` → `id` at the service boundary.** Mongo details do not reach clients.
  Use `.lean()` for reads nobody will mutate.
- **Validate ids before querying** (`assertValidId`), or a malformed id becomes a CastError
  and an ugly 500.
- **Indexes live next to the schema.** Anything filtered or sorted in a hot path gets one.
  For TORs that means at minimum agency, deadline, budget, and published/software flags —
  FR-13's filter set.
- **Literal routes before parameterised ones**, or `/search` arrives as an id of `search`.
- **Do not copy the template's teaching comments into a real module.** They explain the
  pattern to a reader learning it; a shipped module documents its own domain decisions,
  not the framework's.
- The template hand-rolls validation to stay dependency-free. **Reach for `zod` when you
  build the first real module** — the `parse*` function signatures are designed so that
  swap changes nothing downstream.

---

## 7. Open decisions — ask, don't invent

These are genuinely undecided. If a task needs one settled, raise it rather than picking
silently and burying the choice in a diff:

**Settled 2026-09-03** (was open, now decided — recorded so it is not re-litigated):

- **Sources.** Both, behind one `Source` port (§3, §4.2). Product copy says "BMA
  procurement" when serving source A alone.
- **Ingestion boundary.** TypeScript, inside this repo, as services callable from a
  scheduler (§4). The Python spike and the earlier TypeScript draft are archived reference
  in `../testTOR/` — evidence, not dependencies.
- **Ingest data model.** The six collections in §4.3, and the status lifecycle in §4.4.

Still genuinely undecided:

- **Blob storage.** §4.1 stage ③ writes PDFs "to a blob store". Local disk works for a
  4.9k-document BMA scrape; a 512MB national bundle does not belong on the deploy box.
  Local disk vs. S3-compatible object storage vs. GridFS: open.
- **Queue.** NFR-01 mandates one. Technology unchosen. Note §4 is written so a plain cron
  loop works until it exists — the stages hand off through Mongo rows, not calls, so
  introducing a queue later does not reshape the pipeline.
- **Auth.** SRS says Google sign-in (FR-01) with one active token per session (NFR-10).
  Library vs. raw OAuth, session vs. JWT, where the admin flag lives: open.
- **User/team, skill profile and notification collections.** §4.3 covers the ingest half
  only; the matching half is undesigned.
- **OCR + AI provider.** SRS names Vertex AI. With ~69% of TORs scanned, OCR is the real
  cost driver and hasn't been priced. §4.1 stage ④ exists to make that bill predictable
  before it is incurred.
- **Notification channel.** FR-17 says email; SRS §7.2 lists email vs. in-app vs. both as
  unfinalized.
- **Where the deadline comes from**, given neither source supplies one (§3). FR-13 needs
  it. Derive from announcement publish date, extract from the PDF, or take it back to the
  SRS — do not invent a deadline field.

---

## 8. Related repos

- `../BangkokTOR-frontend` — Next.js 16 dashboard, dev on port 3003. Has its own
  `CLAUDE.md` for UI conventions; the API contract lives on this side, so if you change a
  response shape, say so.
- `../testTOR` — the spike and archive (§3). **Reference and evidence, not dependencies.**
  - `bangkoktor_ingest.py` — Python spike against source A; the measured manifest in
    `data/` is where the 69%-scanned and 4,854-TOR figures come from.
  - `egp.py` — the CKAN exploration that found the gateway's limitations.
  - `reference-ts/` — an earlier TypeScript draft of the source clients, archived out of
    `src/` on 2026-09-03 when the backend was reset to rebuild file by file. Read it for
    the verified details (phantom-column realignment, zip magic bytes, the missing
    `content-length`); do not copy it back in wholesale.

---

## 9. Conventions

- **Comments explain *why*, not *what*.** The existing `bun-shims.ts` and `mongo.ts`
  comments are the standard: they document a non-obvious constraint someone would
  otherwise "fix" back into a bug.
- **Thai text is first-class.** Titles, agency names, and qualification text are Thai. No
  ASCII assumptions in slugs, search, sorting, or truncation.
- **Money is THB integers**, as the portal serves them. No floats.
- Commit style is Conventional Commits (`feat:`, `test:`), branches are
  `feat/<issue>/<slug>` against `main`.
