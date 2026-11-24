import { livePath, parseLiveTopic } from "@bookbuddy/api-contract";
import { Hono } from "hono";
import type { ApiEnv } from "../../bindings";
import { getLiveTopic } from "../../realtime/topics";
import { requestSessionCredential } from "../auth/credential";
import { transportFailure } from "../sync/http";

export const liveRoutes = new Hono<ApiEnv>();

liveRoutes.get(livePath, async (c) => {
  const request = c.req.raw;
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return transportFailure(c, "NOT_FOUND");
  const topics = new URL(request.url).searchParams.getAll("topic");
  const topic = topics.length === 1 ? parseLiveTopic(topics[0]!) : null;
  if (!topic) return transportFailure(c, "NOT_FOUND");
  if (!requestSessionCredential(request)) return transportFailure(c, "UNAUTHENTICATED");
  const response = await getLiveTopic(c.env.LIVE).fetch(request);
  if (response.status === 101) return response;
  return transportFailure(c, response.status === 401 ? "UNAUTHENTICATED" : response.status === 404 ? "NOT_FOUND" : "UNAVAILABLE");
});
