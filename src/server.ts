import { createApp } from "./app.ts";
import { assertServeConfig, env } from "./config/env.ts";
import { connectMongo, disconnectMongo } from "./db/mongo.ts";

export async function start() {
  // Before the DB connection, so a misconfigured production deploy fails with
  // one clear message instead of coming up with its write routes wide open.
  assertServeConfig();

  await connectMongo();

  const server = createApp().listen(env.port, () => {
    console.log(`Server listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  return server;
}
