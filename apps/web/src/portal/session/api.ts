import { createApiClient, type ApiClient, type ApiFetch, type RequestOptions } from "@bookbuddy/api-client";
import { getOperationRoute, submitSupportRoute } from "@bookbuddy/api-contract";

export type PortalIdentity = NonNullable<RequestOptions["expectedCookieIdentity"]>;

const baseUrl = "/api/v1";
const supportUrl = baseUrl + submitSupportRoute.path;

export function createPortalApi({ identity, getLocale, isCurrent, onSessionChanged, fetch: send = (url, init) => fetch(url, init) }: {
  identity: PortalIdentity | null;
  getLocale: () => string;
  isCurrent: () => boolean;
  onSessionChanged: () => void;
  fetch?: ApiFetch;
}): ApiClient {
  const client = createApiClient({ baseUrl, getSession: () => null, getExpectedCookieIdentity: () => identity, getLocale,
    // A revoked cookie can remain in the browser to avoid clobbering a newer sign-in.
    fetch: identity ? send : (url, init) => send(url, url === supportUrl ? { ...init, credentials: "omit" } : init),
  });
  return { ...client, async request(route, input, options) {
    if (!isCurrent()) return { ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } };
    const result = await client.request(route, input, identity && route.path === getOperationRoute.path
      ? { ...options, expectedCookieIdentity: identity } : options);
    if (isCurrent() && !result.ok && "current" in result.error && result.error.current?.kind === "session_changed") onSessionChanged();
    return result;
  } };
}
