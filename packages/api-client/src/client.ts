import { expectedContextHeader, expectedSessionHeader, idSchema, livePath, liveTopicName, localeTagSchema, noExpectedContext, operationIdHeader, operationIdSchema, parseResult } from "@bookbuddy/api-contract";
import type {
  LiveTopicKey,
  RequestParts,
  RequestSchema,
  ResponseSchema,
  Result,
  RouteDefinition,
  RouteRequest,
  RouteResponse,
} from "@bookbuddy/api-contract";

type TransportRequest = RequestInit & { redirect?: "error" | "follow" | "manual" };
export type ApiFetch = (url: string, init: TransportRequest) => Promise<Response>;

type ExpectedCookieIdentity = { sessionId: string; contextId: string | null };

export type ApiClientOptions = {
  baseUrl: string;
  getSession: () => string | null | Promise<string | null>;
  getExpectedCookieIdentity?: () => ExpectedCookieIdentity | null;
  getLocale: () => string;
  fetch?: ApiFetch;
};

export type ClientError =
  | { code: "INVALID_INPUT" | "REQUEST_SETUP_FAILED"; delivery: "not_sent" }
  | { code: "NETWORK_ERROR"; delivery: "unknown" }
  | { code: "INVALID_RESPONSE"; delivery: "unknown"; status: number };

export type ApiResult<T> = Result<T> | { ok: false; error: ClientError; meta?: never };
export type RequestOptions = { signal?: NonNullable<RequestInit["signal"]>; expectedCookieIdentity?: ExpectedCookieIdentity };

type LiveSocketOptions = {
  /** A browser supplies its origin; native supplies a connector that can set headers. */
  origin?: string;
  signal: AbortSignal;
  connect: (url: string, headers?: Record<string, string>) => WebSocket;
};

export interface ApiClient {
  request<Input extends RequestSchema, Output extends ResponseSchema>(
    route: RouteDefinition<Input, Output>,
    input: NoInfer<RouteRequest<Input>>,
    options?: RequestOptions,
  ): Promise<ApiResult<RouteResponse<Output>>>;
  openLiveSocket(topic: LiveTopicKey, options: LiveSocketOptions): Promise<WebSocket | null>;
}

function normalizeBaseUrl(value: string): string {
  const absolute = /^https?:\/\//.test(value);
  if (/[\s\\?#]/.test(value) || (!absolute && (!value.startsWith("/") || value.startsWith("//")))) {
    throw new TypeError("API base URL must be absolute HTTP(S) or origin-relative, without query or fragment");
  }
  const url = new URL(value, "https://bookbuddy.invalid");
  if (url.username || url.password) throw new TypeError("API base URL cannot contain credentials");
  return (absolute ? url.origin : "") + url.pathname.replace(/\/+$/, "");
}

function requestUrl(base: string, path: string, { params, query }: RequestParts): string {
  const url = base + path.replace(/\/:([A-Za-z][A-Za-z0-9_]*)(?=\/|$)/g, (_, name: string) => {
    const value = params?.[name];
    if (value === undefined || value === "" || value === "." || value === "..") {
      throw new TypeError("Missing or unsafe route parameter");
    }
    return `/${encodeURIComponent(value)}`;
  });
  if (!query) return url;

  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value == null) continue;
    if (typeof value === "object") {
      for (const item of value) search.append(name, String(item));
    } else {
      search.append(name, String(value));
    }
  }
  const suffix = search.toString();
  return suffix ? `${url}?${suffix}` : url;
}

const defaultFetch: ApiFetch = (url, init) => globalThis.fetch(url, init);

export function createApiClient({ baseUrl, getSession, getExpectedCookieIdentity, getLocale, fetch: transport = defaultFetch }: ApiClientOptions): ApiClient {
  const base = normalizeBaseUrl(baseUrl);

  async function request<Input extends RequestSchema, Output extends ResponseSchema>(
    route: RouteDefinition<Input, Output>,
    input: NoInfer<RouteRequest<Input>>,
    options?: RequestOptions,
  ): Promise<ApiResult<RouteResponse<Output>>> {
    const parsed = route.input.safeParse(input);
    if (!parsed.success || (route.method === "GET" && parsed.data.body !== undefined)) {
      return { ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" } };
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (route.command) {
      const command = parsed.data.body;
      const operationId = operationIdSchema.safeParse(
        command !== null && typeof command === "object" && "operationId" in command ? command.operationId : undefined,
      );
      if (!operationId.success) return { ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" } };
      headers[operationIdHeader] = operationId.data;
    }

    let url: string;
    let body: string | undefined;
    try {
      url = requestUrl(base, route.path, parsed.data);
      if (parsed.data.body !== undefined) {
        body = JSON.stringify(parsed.data.body);
        if (body === undefined) return { ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" } };
        headers["Content-Type"] = "application/json";
      }
    } catch {
      return { ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" } };
    }

    let credentials: RequestInit["credentials"] = "same-origin";
    try {
      const locale = localeTagSchema.parse(getLocale());
      headers["Accept-Language"] = locale;
      if (route.auth !== "public" && route.auth !== "challenge") {
        const identity = options?.expectedCookieIdentity ?? (route.method === "GET" ? null : getExpectedCookieIdentity?.());
        const session = await getSession();
        if (session !== null) {
          if (!/^[A-Za-z0-9._~+\/-]+=*$/.test(session)) throw new TypeError("Invalid bearer credential");
          headers.Authorization = `Bearer ${session}`;
          credentials = "omit";
        } else if (identity) {
          headers[expectedSessionHeader] = idSchema.parse(identity.sessionId);
          headers[expectedContextHeader] = identity.contextId === null ? noExpectedContext : idSchema.parse(identity.contextId);
        }
      }
    } catch {
      return { ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } };
    }

    let response: Response;
    try {
      response = await transport(url, { method: route.method, headers, body, credentials, redirect: "error", signal: options?.signal });
    } catch {
      return { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } };
    }

    try {
      if (!response.redirected) {
        const result = parseResult(route.output, await response.json());
        if (result !== null && result.ok === response.ok) return result;
      }
    } catch {
      // Never surface a raw response or assume a command did not commit.
    }
    return { ok: false, error: { code: "INVALID_RESPONSE", delivery: "unknown", status: response.status } };
  }

  async function openLiveSocket(topic: LiveTopicKey, { origin, signal, connect }: LiveSocketOptions): Promise<WebSocket | null> {
    const url = new URL(`${base}${livePath}`, origin);
    const credential = await getSession();
    if (signal.aborted) return null;
    const serverOrigin = url.origin;
    if (origin ? origin !== serverOrigin || credential !== null : credential === null) return null;
    const socketUrl = `${url.href.replace(/^http/, "ws")}?topic=${encodeURIComponent(liveTopicName(topic))}`;
    return connect(socketUrl, credential ? { Authorization: `Bearer ${credential}`, Origin: serverOrigin } : undefined);
  }

  return { request, openLiveSocket };
}
