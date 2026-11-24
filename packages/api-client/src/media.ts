import { createMediaGrantsRoute, createMediaReadGrantsRoute, recoverMediaRoute, settleMediaRoute } from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createMediaClient(api: ApiClient) {
  return {
    createGrants: (body: RouteRequest<typeof createMediaGrantsRoute.input>["body"], options?: RequestOptions) =>
      api.request(createMediaGrantsRoute, { body }, options),
    settle: (body: RouteRequest<typeof settleMediaRoute.input>["body"], options?: RequestOptions) =>
      api.request(settleMediaRoute, { body }, options),
    createReadGrants: (body: RouteRequest<typeof createMediaReadGrantsRoute.input>["body"], options?: RequestOptions) =>
      api.request(createMediaReadGrantsRoute, { body }, options),
    recover: (body: RouteRequest<typeof recoverMediaRoute.input>["body"], options?: RequestOptions) =>
      api.request(recoverMediaRoute, { body }, options),
  };
}
