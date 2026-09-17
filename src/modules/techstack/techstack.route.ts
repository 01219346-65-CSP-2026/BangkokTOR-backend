import { Router } from "express";
import * as controller from "./techstack.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";

export const techstackRouter = Router();

// Reads stay open; anything that mutates the collection needs the shared
// secret. Before this, an anonymous caller could create or delete rows.
techstackRouter.get("/", controller.listTechstacks);
techstackRouter.post("/", requireAdminToken, controller.createTechstack);

techstackRouter.get("/:id", controller.getTechstack);
techstackRouter.patch("/:id", requireAdminToken, controller.updateTechstack);
techstackRouter.delete("/:id", requireAdminToken, controller.deleteTechstack);
