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
} as const;

export const isProduction = env.nodeEnv === "production";
