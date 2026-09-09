import { Router } from "express";
import { queue, runs, status } from "./monitor.controller.ts";

// Operational views for the admin dashboard (FR-07).
//
// NOTE: these are unauthenticated, like every other route here — the API has no
// auth layer yet. They expose worker hostnames, pids and failure reasons, so
// keep CORS_ORIGINS tight and prefer reaching them through the frontend's
// server-side proxy rather than exposing this port publicly.

export const monitorRouter = Router();

monitorRouter.get("/status", status);
monitorRouter.get("/queue", queue);
monitorRouter.get("/runs", runs);
