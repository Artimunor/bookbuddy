import {
  accountSettingsRoute, emailResendRoute, emailStartRoute, emailStatusRoute,
  emailVerifyRoute, sessionContextRoute, sessionEndRoute, sessionRoute,
} from "@bookbuddy/api-contract";
import type { RouteRequest } from "@bookbuddy/api-contract";
import type { ApiClient, RequestOptions } from "./client";

export function createAuthClient(api: ApiClient) {
  return {
    start: (body: RouteRequest<typeof emailStartRoute.input>["body"], options?: RequestOptions) =>
      api.request(emailStartRoute, { body }, options),
    resend: (attempt: string, body: RouteRequest<typeof emailResendRoute.input>["body"], options?: RequestOptions) =>
      api.request(emailResendRoute, { params: { attempt }, body }, options),
    verify: (attempt: string, body: RouteRequest<typeof emailVerifyRoute.input>["body"], options?: RequestOptions) =>
      api.request(emailVerifyRoute, { params: { attempt }, body }, options),
    status: (attempt: string, options?: RequestOptions) => api.request(emailStatusRoute, { params: { attempt } }, options),
    getSession: (options?: RequestOptions) => api.request(sessionRoute, {}, options),
    switchContext: (body: RouteRequest<typeof sessionContextRoute.input>["body"], options?: RequestOptions) =>
      api.request(sessionContextRoute, { body }, options),
    end: (options?: RequestOptions) => api.request(sessionEndRoute, {}, options),
    patchSettings: (body: RouteRequest<typeof accountSettingsRoute.input>["body"], options?: RequestOptions) =>
      api.request(accountSettingsRoute, { body }, options),
  };
}
