import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { coverRoutes } from "./routes.cover";
import { ordinaryRoutes } from "./routes.ordinary";

export { coverSyncProjection } from "./cover";

export const staffingRoutes = new Hono<ApiEnv>().route("/", coverRoutes).route("/", ordinaryRoutes);
