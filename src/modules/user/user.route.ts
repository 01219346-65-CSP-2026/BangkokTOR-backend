import { Router } from "express";
import * as controller from "./user.controller.ts";


export const userRouter = Router();

userRouter.get("/", controller.listUsers);
userRouter.post("/", controller.createUser);

userRouter.get("/:id", controller.getUser);
userRouter.patch("/:id", controller.updateUser);
userRouter.delete("/:id", controller.deleteUser);