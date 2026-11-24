import type { ApiResult } from "@bookbuddy/api-client";
import type { RequestSchema, ResponseSchema, RouteDefinition, RouteRequest, RouteResponse } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useCallback, useMemo, useRef, useState } from "react";
import { useRepository } from "../repository/hooks";
import { useApiAccess } from "./provider";
import { commandSnapshot, idleCommand, invalidRequest, requestKey, requestNotSent } from "./requests";
import type { CommandSnapshot } from "./requests";

export type CommandInput<Input extends RequestSchema> = RouteRequest<Input> extends { body: infer Body extends { operationId: string } }
  ? Omit<RouteRequest<Input>, "body"> & { body: Omit<Body, "operationId"> & { operationId?: string } }
  : never;
export type CommandAccess<Input extends RequestSchema, Data> = CommandSnapshot<Data> & {
  run: (input: CommandInput<Input>) => Promise<ApiResult<Data>>;
};

export function useCommand<Input extends RequestSchema, Output extends ResponseSchema>(
  route: RouteDefinition<Input, Output> & { command: true },
): CommandAccess<Input, RouteResponse<Output>> {
  type Data = RouteResponse<Output>;
  const { client, requests, isOffline } = useApiAccess();
  const repo = useRepository();
  const intents = useMemo(() => requests.commands<Data>(repo ?? requests, route), [requests, repo, route]);
  const [snapshot, setSnapshot] = useState<{ intents: typeof intents; snapshot: CommandSnapshot<Data> }>();
  const latestRun = useRef<object | null>(null);
  const run = useCallback(async (input: CommandInput<Input>): Promise<ApiResult<Data>> => {
    const invocation = {};
    latestRun.current = invocation;
    const scopeIsActive = () => requests.allows(route.auth, repo);
    if (!client || !scopeIsActive()) {
      if (scopeIsActive()) setSnapshot({ intents, snapshot: commandSnapshot(requestNotSent) });
      return requestNotSent;
    }
    const key = requestKey(input);
    if (key === null) {
      setSnapshot({ intents, snapshot: commandSnapshot(invalidRequest) });
      return invalidRequest;
    }
    const submitted = JSON.parse(key) as CommandInput<Input>;
    if (!submitted || typeof submitted.body !== "object" || submitted.body === null || Array.isArray(submitted.body)) {
      setSnapshot({ intents, snapshot: commandSnapshot(invalidRequest) });
      return invalidRequest;
    }
    setSnapshot({ intents, snapshot: { state: "sending", result: null, error: null } });
    const outcome = await intents.run(key, () => submitted.body.operationId ?? uuid.v4(), (operationId) => {
      if (!scopeIsActive() || isOffline()) return Promise.resolve(requestNotSent);
      // Adding the operation ID reconstructs the original route input. The typed client validates it.
      return client.request(route, { ...submitted, body: { ...submitted.body, operationId } } as RouteRequest<Input>);
    });
    if (latestRun.current === invocation && scopeIsActive()) setSnapshot({ intents, snapshot: commandSnapshot(outcome) });
    return outcome;
  }, [client, requests, isOffline, repo, route, intents]);
  return { ...(requests.allows(route.auth, repo) && snapshot?.intents === intents ? snapshot.snapshot : idleCommand), run };
}
