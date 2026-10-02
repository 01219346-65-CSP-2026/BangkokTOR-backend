function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 8003),
  mongoUri: required("MONGODB_URI"),
  mongoDbName: process.env.MONGODB_DB_NAME ?? "bangkoktor",

  // politeFetch (NFR-07). The UA must carry a real contact address — it is the
  // only thing a portal owner can use to reach us instead of blocking us.
  httpUserAgent:
    process.env.HTTP_USER_AGENT ??
    "BangkokTOR/0.1 (+mailto:kelvinsam233@gmail.com)",
  httpDelayMs: Number(process.env.HTTP_DELAY_MS ?? 400),
  httpTimeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30_000),
  httpMaxAttempts: Number(process.env.HTTP_MAX_ATTEMPTS ?? 4),

  // Ingestion. Not required at boot — the API serves what is already stored
  // whether or not ingestion can run.
  datagothKey: process.env.DATAGOTH_KEY ?? "",
  // Where discovery reads e-GP projects from (AGENTS.md §3):
  //   "all" (default)  — govspending, then bma, in one run: national volume
  //                      and history, plus open tenders with deadlines.
  //   "bma"            — the BMA portal. Lists projects the day they are
  //                      announced, so it is the only feed with OPEN tenders.
  //   "govspending"    — DGA's bulk export. Contracted projects only, all of
  //                      Thailand, fast (one file).
  //   "ckan"           — data.go.th's datastore. Contracted, and a year behind.
  egpFeed: (["ckan", "govspending", "bma"].includes(process.env.EGP_FEED ?? "")
    ? process.env.EGP_FEED
    : "all") as "ckan" | "govspending" | "bma" | "all",
  // BMA discovery reads newest-first back this many days. Unset = from the
  // start of the previous Thai fiscal year, the window the site shows
  // (ingest.service.ts daysSincePreviousFiscalYear).
  bmaLookbackDays: process.env.BMA_LOOKBACK_DAYS ? Number(process.env.BMA_LOOKBACK_DAYS) : undefined,
  // ~17k BMA projects a year at 200 a page; a hard stop well past two years.
  bmaMaxPages: Number(process.env.BMA_MAX_PAGES ?? 250),
  // Show every TOR on the public list, whatever its pipeline state — without
  // waiting for extraction or grading, and including extraction_incomplete
  // (scans). For checking that discovery works. Defaults ON outside
  // production, OFF in production, where FR-11 holds incomplete records back.
  // Set LIST_ALL_TORS=true|false to override either way.
  listAllTors: process.env.LIST_ALL_TORS
    ? process.env.LIST_ALL_TORS === "true"
    : (process.env.NODE_ENV ?? "development") !== "production",
  // Unset = the newest fiscal year the feed has published, resolved per run.
  // Set a Buddhist-era year (e.g. 2569) to pin it. CKAN_FISCAL_YEAR is the old name.
  egpFiscalYear: (() => {
    const raw = process.env.EGP_FISCAL_YEAR || process.env.CKAN_FISCAL_YEAR;
    return raw ? Number(raw) : undefined;
  })(),
  // The govspending bulk zip (~850 MB) is downloaded here, and deleted once a
  // scan of it completes.
  sourceDir: process.env.SOURCE_DIR ?? "./data/source",
  blobDir: process.env.BLOB_DIR ?? "./data/blobs",
  // Bundles and their PDFs are deleted once extraction has read them — only
  // the text (tor_texts) is used downstream, and keeping the files costs
  // ~67 MB per project. The site links to the e-GP zip instead. Set true to
  // keep them for debugging.
  keepDocumentFiles: process.env.KEEP_DOCUMENT_FILES === "true",
  extractDir: process.env.EXTRACT_DIR ?? "./data/extracted",

  workerLeaseMs: Number(process.env.WORKER_LEASE_MS ?? 900_000),
  workerIdleMs: Number(process.env.WORKER_IDLE_MS ?? 5_000),
  workerMaxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS ?? 3),

  // How often a worker says it is still alive. The monitor calls a worker stale
  // at 3 missed beats, so this also sets how fast a death is noticed.
  heartbeatMs: Number(process.env.HEARTBEAT_MS ?? 5_000),

  // Browsers send no credentials to these routes, but an allowlist is still the
  // right default: the API has no auth, so any origin that can call it can read
  // the whole pipeline. Comma-separated.
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3003")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  // Shared secret for the routes that start pipeline work, write user data, or
  // read the private grade. Not user auth — see middleware/adminToken.ts.
  // Required in production; optional in dev so a local run needs no setup.
  adminToken: process.env.ADMIN_TOKEN ?? "",
  // HS256 secret the frontend signs its per-request user token with (see
  // BangkokTOR-frontend/src/api/client.ts). Must match the frontend's value.
  // Unset means the /api/me routes answer 401 — they never fall open.
  internalJwtSecret: process.env.INTERNAL_JWT_SECRET ?? "",

  // Per-IP request ceilings. Reads are generous enough that normal browsing
  // never notices; the `/run` endpoints are near-zero because each one costs
  // minutes of GPU or network time.
  rateLimitReadMax: Number(process.env.RATE_LIMIT_READ_MAX ?? 120),
  rateLimitPipelineMax: Number(process.env.RATE_LIMIT_PIPELINE_MAX ?? 60),
  rateLimitWriteMax: Number(process.env.RATE_LIMIT_WRITE_MAX ?? 20),
  rateLimitRunMax: Number(process.env.RATE_LIMIT_RUN_MAX ?? 2),
  rateLimitProfileMax: Number(process.env.RATE_LIMIT_PROFILE_MAX ?? 60),

  // Verified bundles reach 512,452,129 bytes. Anything past this is recorded
  // as oversize rather than filling the disk.
  maxBundleBytes: Number(process.env.MAX_BUNDLE_BYTES ?? 200_000_000),

  // Zip-bomb guards: a bundle that expands past either of these is refused.
  maxZipEntries: Number(process.env.MAX_ZIP_ENTRIES ?? 200),
  maxUnzippedBytes: Number(process.env.MAX_UNZIPPED_BYTES ?? 1_000_000_000),

  // AI grading. Ollama now, Vertex later — see lib/ai/types.ts for the port.
  aiProvider: process.env.AI_PROVIDER ?? "ollama",
  ollamaUrl: process.env.OLLAMA_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "qwen2.5:7b",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 300_000),

  // Max amount of characters to extract from tor before truncating.
  maxFulltextChars: Number(process.env.MAX_FULLTEXT_CHARS ?? 400_000),
} as const;

export const isProduction = env.nodeEnv === "production";

// Fail at boot rather than silently serving the pipeline's trigger endpoints to
// anyone who finds them. Dev is exempt so a fresh clone runs with no setup.
export function assertServeConfig(): void {
  if (isProduction && !env.adminToken) {
    throw new Error(
      "ADMIN_TOKEN is not set — the /run, write, and grade routes would be unprotected in production. See .env.example.",
    );
  }
  if (isProduction && !env.internalJwtSecret) {
    throw new Error(
      "INTERNAL_JWT_SECRET is not set — signed-in users could not reach /api/me. See .env.example.",
    );
  }
}

// Ingestion needs the CKAN key; serving does not. Called at the start of a run
// so the failure is one clear message, not a 403 sixteen pages in.
export function assertIngestConfig(): void {
  // The BMA portal needs no key; every other feed (and "all") does.
  if (env.egpFeed !== "bma" && !env.datagothKey) {
    throw new Error(
      "DATAGOTH_KEY is not set — the national feeds cannot run. Copy it from ~/Code/testTOR/.env, or set EGP_FEED=bma",
    );
  }
}
