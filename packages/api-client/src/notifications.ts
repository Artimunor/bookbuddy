import { deletePushInstallationRoute, notificationReadRoute, notificationsRoute, putPushInstallationRoute } from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function listNotifications(client: ApiClient, query: RouteRequest<typeof notificationsRoute.input>["query"], options?: RequestOptions) {
  return client.request(notificationsRoute, { query }, options);
}

export function markNotificationsRead(client: ApiClient, body: RouteRequest<typeof notificationReadRoute.input>["body"], options?: RequestOptions) {
  return client.request(notificationReadRoute, { body }, options);
}

export function putPushInstallation(client: ApiClient, input: RouteRequest<typeof putPushInstallationRoute.input>, options?: RequestOptions) {
  return client.request(putPushInstallationRoute, input, options);
}

export function deletePushInstallation(client: ApiClient, input: RouteRequest<typeof deletePushInstallationRoute.input>, options?: RequestOptions) {
  return client.request(deletePushInstallationRoute, input, options);
}
