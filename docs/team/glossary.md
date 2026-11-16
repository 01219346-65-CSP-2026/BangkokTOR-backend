# Glossary

> Shared file, identical in the backend and frontend repos. Change both.

| Term | Meaning here |
|---|---|
| **AC** (acceptance criteria) | Testable conditions on a Jira ticket that decide whether it's done |
| **Advisory** | The neutral, non-accusing legitimacy notice shown to signed-in users (FR-19, FR-20) |
| **BE year** | Buddhist Era year = CE + 543 (2569 BE = 2026 CE). Thai sources and `/api/budget` use it |
| **BFF** | "Backend for frontend": the Next.js `/api/*` route handlers that call the real API server-side |
| **BMA** | Bangkok Metropolitan Administration; runs the `egp2.bangkok.go.th` portal |
| **Bundle** | The ZIP of TOR documents downloaded from national e-GP for one project |
| **CKAN** | The open-data platform behind `data.go.th`; one of our national sources |
| **e-GP** | Thailand's electronic Government Procurement system (`gprocurement.go.th`) |
| **Fiscal year (FY)** | The Thai government year, 1 Oct – 30 Sep, numbered in BE |
| **FR / NFR** | Functional / non-functional requirement in the SRS, e.g. FR-13 |
| **Grade** | The private A/B/C legitimacy score from rule checks plus Gemini. Never shown publicly (FR-19) |
| **Heartbeat** | The row each worker updates regularly so the admin page can tell live, stale and dead workers apart |
| **Hotfix** | An urgent fix that goes straight to `main`, skipping UAT |
| **Ingest** | Pulling project records and documents from the source portals into Mongo |
| **OCR** | Reading text from scanned PDFs. Most TOR PDFs are scans |
| **PublicTor** | The TOR shape the public API returns, with the private fields removed |
| **Signals** | Rule findings about a TOR's qualification terms, shown as advisory hints |
| **SRS** | Software Requirements Specification (`CSP project v2.pdf`) |
| **TOR** | Terms of Reference: the government document saying what will be procured and who may bid |
| **UAT** | User Acceptance Testing, done on `QA` before production |
| **Watermark** | The saved resume point per source. The portals can't report what changed, so we track it |
| **Worker** | A separate Bun process (ingest, extract, grade, summarize, email) that claims queue rows and processes them |
