import { Router } from "express";
import * as controller from "./thing.controller.ts";


export const thingRouter = Router();

thingRouter.get("/", controller.listThings);
thingRouter.post("/", controller.createThing);

thingRouter.get("/:id", controller.getThing);
thingRouter.patch("/:id", controller.updateThing);
thingRouter.delete("/:id", controller.deleteThing);