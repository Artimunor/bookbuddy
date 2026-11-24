import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

// These are transport expectations, not authorization rules. The Worker still checks live grants.
export type AuthScope = "public" | "challenge" | "optional-session" | "session" | "context" | "ops";

type QueryValue = string | number | boolean;
export type RequestParts = {
  params?: Record<string, string | number | undefined>;
  query?: Record<string, QueryValue | readonly QueryValue[] | null | undefined>;
  body?: unknown;
};

export type RequestSchema = z.ZodType<RequestParts>;
export type ResponseSchema = z.ZodType;
export type RouteRequest<Input extends RequestSchema> = z.input<Input>;
export type RouteResponse<Output extends ResponseSchema> = z.output<Output>;

type CommandRequest = RequestParts & { body: { operationId: string } };

export type RouteDefinition<
  Input extends RequestSchema = RequestSchema,
  Output extends ResponseSchema = ResponseSchema,
> = {
  path: `/${string}`;
  input: Input;
  output: Output;
  auth: AuthScope;
} & (
  | { method: HttpMethod; command?: false }
  | { method: Exclude<HttpMethod, "GET">; command: true; input: z.ZodType<CommandRequest> }
);

// Use the same relative API path in Hono and on the client, with whole-segment :param names.
export function defineRoute<const Route extends RouteDefinition>(route: Route): Route {
  if (!route.path.slice(1).split("/").every((segment) =>
    segment !== "." && segment !== ".." && /^(?:[A-Za-z0-9._~-]+|:[A-Za-z][A-Za-z0-9_]*)$/.test(segment)
  )) {
    throw new TypeError("API route must use a relative path with whole-segment parameters");
  }
  return route;
}
