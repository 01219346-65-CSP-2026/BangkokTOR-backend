import { Router } from "express";
import * as controller from "./techstack.controller.ts";


export const techstackRouter = Router();

techstackRouter.get("/", controller.listTechstacks);
techstackRouter.post("/", controller.createTechstack);

techstackRouter.get("/:id", controller.getTechstack);
techstackRouter.patch("/:id", controller.updateTechstack);
techstackRouter.delete("/:id", controller.deleteTechstack);