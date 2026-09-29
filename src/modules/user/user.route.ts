import { Router } from "express";
import * as controller from "./user.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";

export const userRouter = Router();

// Reads stay open; anything that mutates the collection needs the shared
// secret. Before this, an anonymous caller could create or delete rows.
userRouter.get("/", controller.listUsers);
userRouter.post("/", requireAdminToken, controller.createUser);
// Sign-in upsert. Same shared secret: only the frontend's server calls it.
userRouter.post("/sync", requireAdminToken, controller.syncUser);

userRouter.get("/:id", controller.getUser);
userRouter.patch("/:id", requireAdminToken, controller.updateUser);
userRouter.delete("/:id", requireAdminToken, controller.deleteUser);
