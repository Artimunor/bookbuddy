import { syncRoute } from "@bookbuddy/api-contract";
import type { SyncRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function sync(client: ApiClient, body: SyncRequest, options?: RequestOptions) {
  return client.request(syncRoute, { body }, options);
}
