import {
  appendThreadEntriesRoute, getThreadEntriesRoute, getThreadRoute, listThreadsRoute, markThreadReadRoute,
  reportTranslationRoute, requestTranslationRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createChatClient(api: ApiClient) {
  return {
    listThreads: (query?: RouteRequest<typeof listThreadsRoute.input>["query"], options?: RequestOptions) =>
      api.request(listThreadsRoute, { query }, options),
    getThread: (id: string, options?: RequestOptions) => api.request(getThreadRoute, { params: { id } }, options),
    getThreadEntries: (id: string, query?: RouteRequest<typeof getThreadEntriesRoute.input>["query"], options?: RequestOptions) =>
      api.request(getThreadEntriesRoute, { params: { id }, query }, options),
    appendThreadEntries: (id: string, body: RouteRequest<typeof appendThreadEntriesRoute.input>["body"], options?: RequestOptions) =>
      api.request(appendThreadEntriesRoute, { params: { id }, body }, options),
    markThreadRead: (id: string, body: RouteRequest<typeof markThreadReadRoute.input>["body"], options?: RequestOptions) =>
      api.request(markThreadReadRoute, { params: { id }, body }, options),
    reportTranslation: (id: string, body: RouteRequest<typeof reportTranslationRoute.input>["body"], options?: RequestOptions) =>
      api.request(reportTranslationRoute, { params: { id }, body }, options),
    requestTranslation: (id: string, body: RouteRequest<typeof requestTranslationRoute.input>["body"], options?: RequestOptions) =>
      api.request(requestTranslationRoute, { params: { id }, body }, options),
  };
}
