import type { ApiResult } from "@bookbuddy/api-client";
import type { RequestSchema, ResponseSchema, RouteDefinition, RouteRequest, RouteResponse } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRepository } from "../repository/hooks";
import { useApiAccess } from "./provider";
import { commandIntentForRequest, commandIntentKey, commandSnapshot, idleCommand, invalidRequest, requestKey, requestNotSent } from "./requests";
import type { CommandIntent, CommandIntentKey, CommandSnapshot, PendingCommandStatus } from "./requests";

export type CommandInput<Input extends RequestSchema> = RouteRequest<Input> extends { body: infer Body extends { operationId: string } }
  ? Omit<RouteRequest<Input>, "body"> & { body: Omit<Body, "operationId"> & { operationId?: string } }
  : never;
export type CommandAccess<Input extends RequestSchema, Data> = CommandSnapshot<Data> & {
  run: (input: CommandInput<Input>) => Promise<ApiResult<Data>>;
};

function usePendingCommand<Data>(intent: CommandIntent<Data> | null): PendingCommandStatus {
  const subscribe = useCallback((listener: () => void) => intent?.subscribe(listener) ?? (() => {}), [intent]);
  const snapshot = useCallback(() => intent?.getSnapshot() ?? "idle", [intent]);
  useEffect(() => { if (intent) void intent.hydrate(); }, [intent]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function useCommandStatus(intentKey: CommandIntentKey | null | undefined): PendingCommandStatus {
  const { requests } = useApiAccess();
  const repo = useRepository();
  return usePendingCommand(intentKey && requests.authenticated && requests.active && repo?.isActive !== false
    ? requests.command(repo, intentKey) : null);
}

export function useCommand<Input extends RequestSchema, Output extends ResponseSchema>(
  route: RouteDefinition<Input, Output> & { command: true },
  { resourceId }: { resourceId?: string | readonly string[] } = {},
): CommandAccess<Input, RouteResponse<Output>> {
  type Data = RouteResponse<Output>;
  const { client, requests, isOffline } = useApiAccess();
  const repo = useRepository();
  const [local, setLocal] = useState<{
    book: typeof requests; repo: typeof repo; route: typeof route; key: CommandIntentKey | null; snapshot: CommandSnapshot<Data>;
  }>();
  const latestRun = useRef<object | null>(null);
  const boundKey = resourceId === undefined ? undefined : commandIntentKey(route, resourceId);
  const active = requests.allows(route.auth, repo);
  const current = active && local?.book === requests && local.repo === repo && local.route === route &&
    (boundKey === undefined || local.key === boundKey) ? local : null;
  const observedKey = boundKey === undefined ? current?.key : boundKey;
  const pending = usePendingCommand(active && observedKey ? requests.command<Data>(repo, observedKey) : null);

  const run = useCallback(async (input: CommandInput<Input>): Promise<ApiResult<Data>> => {
    const invocation = {};
    latestRun.current = invocation;
    const scopeIsActive = () => requests.allows(route.auth, repo);
    const fail = (outcome: typeof invalidRequest | typeof requestNotSent) => {
      if (scopeIsActive()) setLocal({ book: requests, repo, route, key: boundKey ?? null, snapshot: commandSnapshot(outcome) });
      return outcome;
    };
    if (!client || !scopeIsActive()) return fail(requestNotSent);
    const encoded = requestKey(input);
    if (encoded === null) return fail(invalidRequest);
    const submitted = JSON.parse(encoded) as CommandInput<Input>;
    if (!submitted || typeof submitted.body !== "object" || submitted.body === null || Array.isArray(submitted.body)) return fail(invalidRequest);
    const requestedId = submitted.body.operationId;
    const proposedId = requestedId ?? uuid.v4();
    const validated = route.input.safeParse({ ...submitted, body: { ...submitted.body, operationId: proposedId } });
    if (!validated.success) return fail(invalidRequest);
    const key = boundKey === undefined ? commandIntentForRequest(route, validated.data) : boundKey;
    // The command schema guarantees this envelope; the generic request type erases its body.
    const { operationId: _operationId, ...body } = validated.data.body as { operationId: string };
    const inputKey = requestKey({ ...validated.data, body });
    if (key === null || inputKey === null) return fail(invalidRequest);

    const intent = requests.command<Data>(repo, key);
    setLocal({ book: requests, repo, route, key, snapshot: idleCommand });
    const outcome = await intent.run(inputKey, proposedId, requestedId, () => scopeIsActive() && !isOffline(), (operationId) =>
      client.request(route, { ...submitted, body: { ...submitted.body, operationId } } as RouteRequest<Input>));
    if (latestRun.current === invocation && scopeIsActive()) {
      setLocal({ book: requests, repo, route, key, snapshot: commandSnapshot(outcome) });
    }
    return outcome;
  }, [client, requests, isOffline, repo, route, boundKey]);
  const snapshot = current?.snapshot ?? idleCommand;
  if (pending === "sending") return { state: "sending", result: null, error: null, run };
  if (pending === "checking") return { state: "checking", result: null, error: snapshot.state === "checking" ? snapshot.error : null, run };
  return { ...(snapshot.state === "checking" ? idleCommand : snapshot), run };
}
