import { Router } from "express";
import { healthRouter } from "./health.route.ts";
import { exampleRouter } from "../modules/_template/example.route.ts";
import { thingRouter } from "../modules/_thing/thing.route.ts";
import { notificationRouter } from "../modules/notification/notification.route.ts";
import { techstackRouter } from "../modules/techstack/techstack.route.ts";
import { userRouter } from "../modules/user/user.route.ts";

export const routes = Router();

routes.get("/", (_req, res) => {
  res.json({ message: "BangkokTOR backend is running" });
});

routes.use(healthRouter);
// Mount feature routers here, e.g. routes.use("/tours", toursRouter);

//routes.use("/api/example", exampleRouter);
//routes.use("/api/thing", thingRouter);

routes.use("/api/notification", notificationRouter);
routes.use("/api/techstack", techstackRouter);
routes.use("/api/user", userRouter);