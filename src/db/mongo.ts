import mongoose from "mongoose";
import { env, isProduction } from "../config/env.ts";

const READY_STATES = ["disconnected", "connected", "connecting", "disconnecting"] as const;

export async function connectMongo(): Promise<typeof mongoose> {
  mongoose.set("strictQuery", true);
  if (!isProduction) {
    mongoose.set("debug", process.env.MONGOOSE_DEBUG === "true");
  }

  mongoose.connection.on("connected", () => {
    console.log(`Mongo connected (db: ${mongoose.connection.name})`);
  });
  mongoose.connection.on("error", (err: unknown) => {
    console.error("Mongo connection error:", err);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("Mongo disconnected");
  });

  return mongoose.connect(env.mongoUri, {
    dbName: env.mongoDbName,
    serverSelectionTimeoutMS: 5000,
  });
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

export function mongoState(): (typeof READY_STATES)[number] | "unknown" {
  return READY_STATES[mongoose.connection.readyState] ?? "unknown";
}

/** Round-trips a ping to the server — proves the connection actually works. */
export async function pingMongo(): Promise<boolean> {
  const db = mongoose.connection.db;
  if (!db) return false;
  try {
    await db.admin().command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}
