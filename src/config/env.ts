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
} as const;

export const isProduction = env.nodeEnv === "production";
