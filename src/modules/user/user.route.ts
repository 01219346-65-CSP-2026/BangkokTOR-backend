import { Router } from "express";
import * as controller from "./user.controller.ts";
import { requireAdminToken } from "../../middleware/adminToken.ts";
import { requireUser } from "../../middleware/requireUser.ts";
import { requireRole } from "../../middleware/requireRole.ts";

export const userRouter = Router();

// T08: these two reads returned every user's email, Google id, role and full
// profile to anyone, and `listUsers` accepted `?role=admin` — the only thing
// stopping a dump was the backend publishing no port. requireAdminToken (the
// shared secret) is the wrong gate here: these identify real people, so they
// get the same requireUser + requireRole("admin") the admin dashboard uses
// (see monitor.route.ts), not the pipeline-trigger shared secret.
userRouter.get("/", requireUser, requireRole("admin"), controller.listUsers);
userRouter.post("/", requireAdminToken, controller.createUser);
// Sign-in upsert. Same shared secret: only the frontend's server calls it.
userRouter.post("/sync", requireAdminToken, controller.syncUser);

userRouter.get("/:id", requireUser, requireRole("admin"), controller.getUser);
userRouter.patch("/:id", requireAdminToken, controller.updateUser);
userRouter.delete("/:id", requireAdminToken, controller.deleteUser);
