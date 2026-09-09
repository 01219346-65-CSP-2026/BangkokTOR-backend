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
  ckanResourceId:
    process.env.CKAN_RESOURCE_ID ?? "e4eaa1b4-eb1a-4534-b227-988ee25b898d",
  blobDir: process.env.BLOB_DIR ?? "./data/blobs",
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
} as const;

export const isProduction = env.nodeEnv === "production";

// Ingestion needs the CKAN key; serving does not. Called at the start of a run
// so the failure is one clear message, not a 403 sixteen pages in.
export function assertIngestConfig(): void {
  if (!env.datagothKey) {
    throw new Error(
      "DATAGOTH_KEY is not set — CKAN discovery cannot run. Copy it from ~/Code/testTOR/.env",
    );
  }
}
