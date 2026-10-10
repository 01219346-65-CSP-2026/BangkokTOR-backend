// Sends a captured batch to BangkokTOR's capture endpoint. Runs as the
// extension's service worker, so the request carries the extension's host
// permission rather than e-GP's origin — no CORS, and no e-GP cookies.

const BATCH = 2000; // the endpoint's per-call cap (ingest.validation.ts MAX_CAPTURE)

async function settings() {
  const { backendUrl = "http://localhost:8003", adminToken = "" } = await chrome.storage.local.get(["backendUrl", "adminToken"]);
  return { backendUrl: backendUrl.replace(/\/+$/, ""), adminToken };
}

async function send(projects, source) {
  const { backendUrl, adminToken } = await settings();
  const total = { received: 0, enqueued: 0, alreadyHeld: 0, invalid: 0 };

  const url = `${backendUrl}/api/ingest/capture`;
  for (let i = 0; i < projects.length; i += BATCH) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(adminToken ? { "X-Admin-Token": adminToken } : {}) },
        body: JSON.stringify({ source, projects: projects.slice(i, i + BATCH) }),
      });
    } catch (error) {
      // "Failed to fetch" alone says nothing; name the address that failed.
      console.error("BangkokTOR capture: request to", url, "failed", error);
      throw new Error(`cannot reach ${url} (${error.message}) — is the backend running, and is the URL in the extension's options right?`);
    }
    if (!response.ok) {
      // The endpoint answers 404 to a wrong or missing token (adminToken.ts).
      const hint = response.status === 404 ? " — check the admin token in the extension's options" : "";
      throw new Error(`HTTP ${response.status}${hint}`);
    }
    const r = await response.json();
    for (const key of Object.keys(total)) total[key] += r[key] ?? 0;
  }
  return total;
}

/** Options page "Test connection": an empty batch, which the endpoint accepts
 *  and answers with zero counts — proves URL, CORS and token in one call. */
async function test() {
  const { backendUrl, adminToken } = await settings();
  const url = `${backendUrl}/api/ingest/capture`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(adminToken ? { "X-Admin-Token": adminToken } : {}) },
      body: JSON.stringify({ source: "egp-search", projects: [] }),
    });
    if (response.ok) return `OK — ${url} answered`;
    return response.status === 404 ? `${url} answered 404: wrong or missing admin token` : `${url} answered HTTP ${response.status}`;
  } catch (error) {
    return `cannot reach ${url}: ${error.message}`;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type === "bkt-test") {
    test().then((text) => reply({ text }));
    return true;
  }
  if (message?.type !== "bkt-send") return false;
  send(message.projects ?? [], message.source)
    .then((result) => reply({ ok: true, result }))
    .catch((error) => reply({ ok: false, error: String(error.message ?? error) }));
  return true; // reply asynchronously
});
