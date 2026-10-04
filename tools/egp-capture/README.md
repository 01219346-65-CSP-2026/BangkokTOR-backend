# BangkokTOR e-GP capture

Gets open tenders from every agency into BangkokTOR. e-GP lists them only in its search, which sits behind a Cloudflare check.

**What it does:** you search e-GP in your own browser, as any visitor does. The extension reads the results e-GP returns to your page and sends the project numbers to BangkokTOR when you click. The backend then fills in each project from e-GP's per-project pages, which aren't gated: stage, budget, method, deadline, documents.

**What it does not do:**
- It sends no requests to e-GP of its own, and doesn't page through results by itself.
- It doesn't touch the Cloudflare pass (`X-Announcement-Token`).

Getting past the check is you, in your browser. That is the line we don't cross.

## Install (Brave or Chrome)

1. Open `brave://extensions` (or `chrome://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (`tools/egp-capture`).
3. Open the extension's **Details → Extension options**:
   - **Backend URL:** `http://localhost:8003`, or wherever the backend runs.
   - **Admin token:** the backend's `ADMIN_TOKEN`. Leave it empty if that's unset in development.

## Daily use, one click

1. Open <https://process5.gprocurement.go.th/egp-agpc01-web/announcement>.
2. In the search form, set **ประเภทประกาศ = ประกาศเชิญชวน** and a date range (say, the last 7 days). Add other filters if you want; software is picked out on our side, so they aren't needed.
3. Click e-GP's **ค้นหา** (search). The BangkokTOR panel in the corner counts the projects it captured.
   - Every results page you open is added to the count.
   - If e-GP's export button returns the whole result set to the page, clicking it captures everything at once.
4. Click **ส่งไป BangkokTOR**. The panel shows, for example, `ส่งแล้ว 38 · ใหม่ 31 · มีอยู่แล้ว 7` (sent 38, new 31, already held 7).

With `bun run worker` running, each new project is read from e-GP:
- Software tenders become TORs, with their deadline read from the signed ประกาศเชิญชวน once e-GP publishes it.
- Everything else is dropped.

Captured TORs are re-checked on every `discover` run and by `bun run refresh-bidding`.

## Notes

- Project numbers are found by pattern (11 digits: Buddhist-era year, month, 7 digits), so the capture keeps working if e-GP changes its response format.
- A search that came back with `validateCfTurnTile: false` (the check failed) has no rows, so nothing is captured. Reload the page and search again.
- The endpoint is `POST /api/ingest/capture` (`src/modules/ingest/`). It queues the ids and returns immediately; the reading from e-GP happens in the worker.
