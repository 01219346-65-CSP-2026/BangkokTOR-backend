import { Router } from "express";
import * as controller from "./example.controller.ts";

/**
 * The ROUTE layer is a table of contents: method + path -> handler.
 * Read it top to bottom and you know the module's entire public surface.
 *
 * Paths here are relative — the parent decides the prefix in routes/index.ts
 * (`routes.use("/examples", exampleRouter)`), so the module can be remounted
 * anywhere without editing this file.
 */
export const exampleRouter = Router();

// Order matters: literal paths before parameterised ones, or "/search" would
// be swallowed by "/:id" and arrive as an id of "search".
exampleRouter.get("/", controller.listExamples);
exampleRouter.post("/", controller.createExample);

exampleRouter.get("/:id", controller.getExample);
exampleRouter.patch("/:id", controller.updateExample);
exampleRouter.delete("/:id", controller.deleteExample);

// Per-route middleware slots in as an argument before the handler, e.g.
//   exampleRouter.post("/", requireAuth, controller.createExample);
