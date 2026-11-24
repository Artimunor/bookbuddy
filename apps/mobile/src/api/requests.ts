import type { ApiResult, RequestOptions } from "@bookbuddy/api-client";
import { idSchema } from "@bookbuddy/api-contract";
import type { AuthScope, RequestParts, RequestSchema, ResponseSchema, RouteDefinition, RouteResponse } from "@bookbuddy/api-contract";
import type { OnlineReceipt, ScopedRepository } from "../repository/repository";

export type ApiError = Extract<ApiResult<never>, { ok: false }>["error"];
export type RemoteStatus = "idle" | "loading" | "ready" | "error" | "offline";
export type CommandStatus = "idle" | "sending" | "done" | "conflict" | "checking" | "failed";
export type PendingCommandStatus = "idle" | "sending" | "checking";
export type CommandIntentKey = `${string}#${string}`;
export type ReadSnapshot<Data> =
  | { status: "ready"; data: Data; error: null; lastConfirmedAt: number }
  | { status: "idle" | "loading" | "error"; data: null; error: ApiError | null; lastConfirmedAt: null }
  | typeof offlineRead;
export type CommandSnapshot<Data> = { state: CommandStatus; result: Data | null; error: ApiError | null };
export const idleRead = { status: "idle", data: null, error: null, lastConfirmedAt: null } as const;
export const offlineRead = { status: "offline", data: null, error: null, lastConfirmedAt: null } as const;
// Online again, but the prior authorization proof is no longer usable.
const unconfirmedRead = { status: "error", data: null, error: null, lastConfirmedAt: null } as const;
export const idleCommand: CommandSnapshot<never> = { state: "idle", result: null, error: null };
export const invalidRequest = { ok: false, error: { code: "INVALID_INPUT", delivery: "not_sent" } } as const;
export const requestNotSent = { ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } } as const;
const requestUncertain = { ok: false, error: { code: "NETWORK_ERROR", delivery: "unknown" } } as const;
const readFreshFor = 30_000;
const maxReadKeys = 32;

type Call<Data> = (signal: NonNullable<RequestOptions["signal"]>) => Promise<ApiResult<Data>>;

export type ReadConnection = { readonly offline: boolean; readonly generation: number };
export type ReadFence = ReadConnection & { readonly visibility?: number };
export const initialReadConnection: ReadConnection = { offline: false, generation: 0 };

export function observeReadConnection(previous: ReadConnection, { isConnected, isInternetReachable }: {
  isConnected?: boolean; isInternetReachable?: boolean;
}): ReadConnection {
  const offline = isConnected === false || isInternetReachable === false;
  if (offline === previous.offline || (!offline && isConnected !== true && isInternetReachable !== true)) return previous;
  return { offline, generation: previous.generation + (offline ? 1 : 0) };
}

function sameReadGeneration(a: ReadFence, b: ReadFence) {
  return a.generation === b.generation && a.visibility === b.visibility;
}

// Object identity has no wire meaning; array order and non-default values do.
export function requestKey(input: unknown): string | null {
  try {
    return JSON.stringify(input, (_key, value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }) ?? null;
  } catch {
    return null;
  }
}

export function remoteRequestKey(route: RouteDefinition, input: unknown): string | null {
  const parsed = route.input.safeParse(input);
  return parsed.success && parsed.data.body === undefined ? requestKey(parsed.data) : null;
}

export class RemoteRead<Data> {
  private snapshot: ReadSnapshot<Data> = idleRead;
  private confirmedAt: number | null = null;
  private fence: ReadFence | null = null;
  private inFlight: { fence: ReadFence; promise: Promise<void>; abort: AbortController } | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now = Date.now) {}

  getSnapshot(fence: ReadFence): ReadSnapshot<Data> {
    if (fence.offline) return offlineRead;
    if (this.snapshot.status === "offline" || (this.fence && !sameReadGeneration(fence, this.fence))) return unconfirmedRead;
    return this.snapshot;
  }
  get stale() {
    if (this.confirmedAt === null || this.snapshot.status !== "ready") return false;
    const elapsed = this.now() - this.confirmedAt;
    return elapsed < 0 || elapsed >= readFreshFor;
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(snapshot: ReadSnapshot<Data>) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  seed(data: Data, serverTime: number, fence: ReadFence): boolean {
    if (fence.offline) return false;
    if (this.snapshot.status === "ready" && this.fence && sameReadGeneration(this.fence, fence) &&
      this.snapshot.lastConfirmedAt > serverTime) return false;
    this.inFlight?.abort.abort();
    this.inFlight = null;
    this.fence = fence;
    this.confirmedAt = this.now();
    this.publish({ status: "ready", data, error: null, lastConfirmedAt: serverTime });
    return true;
  }

  load(call: Call<Data>, { refresh = false, getConnection }: { refresh?: boolean; getConnection: () => ReadFence }): Promise<void> {
    const fence = getConnection();
    if (this.inFlight && sameReadGeneration(this.inFlight.fence, fence)) return this.inFlight.promise;
    if (fence.offline) {
      this.confirmedAt = null;
      this.publish(offlineRead);
      return Promise.resolve();
    }
    if (!refresh && this.fence && sameReadGeneration(this.fence, fence) && this.snapshot.status === "ready" && !this.stale) return Promise.resolve();
    this.inFlight?.abort.abort();
    const abort = new AbortController();
    const stillConnected = () => {
      const current = getConnection();
      return !current.offline && sameReadGeneration(current, fence);
    };
    const flight = Promise.resolve()
      .then(() => stillConnected() ? call(abort.signal) : requestNotSent)
      .catch(() => requestUncertain)
      .then((outcome) => {
        if (this.inFlight?.promise !== flight) return;
        this.inFlight = null;
        if (!stillConnected()) {
          this.confirmedAt = null;
          this.publish(offlineRead);
        } else if (outcome.ok) {
          this.confirmedAt = this.now();
          this.publish({ status: "ready", data: outcome.data, error: null, lastConfirmedAt: outcome.meta.serverTime });
        } else {
          this.confirmedAt = null;
          this.publish({ status: "error", data: null, error: outcome.error, lastConfirmedAt: null });
        }
      });
    this.fence = fence;
    this.inFlight = { fence, promise: flight, abort };
    this.publish({ status: "loading", data: null, error: null, lastConfirmedAt: null });
    return flight;
  }
}

export function commandSnapshot<Data>(outcome: ApiResult<Data>): CommandSnapshot<Data> {
  if (outcome.ok) return { state: "done", result: outcome.data, error: null };
  const error = outcome.error;
  const conflict = error.code === "CONFLICT" || error.code === "STALE_REVISION" || error.code === "OPERATION_ID_REUSED";
  const checking = ("delivery" in error && error.delivery === "unknown") || error.code === "INTERNAL_ERROR";
  return { state: conflict ? "conflict" : checking ? "checking" : "failed", result: null, error };
}

export function commandIntentKey(route: Pick<RouteDefinition, "method" | "path">, resourceId?: string | readonly string[]): CommandIntentKey | null {
  const ids = typeof resourceId === "string" ? [resourceId] : resourceId ?? [];
  if (!ids.every((id) => idSchema.safeParse(id).success)) return null;
  return `${route.method} ${route.path}#${ids.join(".")}`;
}

export function commandIntentForRequest(route: RouteDefinition, { params }: RequestParts): CommandIntentKey | null {
  const ids: string[] = [];
  for (const part of route.path.split("/")) {
    if (!part.startsWith(":")) continue;
    const value = params?.[part.slice(1)];
    if (value === undefined) return null;
    ids.push(String(value));
  }
  return commandIntentKey(route, ids);
}

type ReceiptStore = Pick<ScopedRepository, "getOnlineReceipt" | "claimOnlineReceipt" | "removeOnlineReceipt">;
interface PendingCommand<Data> {
  id: string;
  receipt?: OnlineReceipt;
  inputKey?: string;
  uncertain?: ApiResult<Data>;
}

export class CommandIntent<Data> {
  private status: PendingCommandStatus = "idle";
  private readonly listeners = new Set<() => void>();
  private loaded = false;
  private hydration: Promise<void> | null = null;
  private pending: PendingCommand<Data> | null = null;
  private inFlight: { inputKey: string; requestedId?: string; promise: Promise<ApiResult<Data>> } | null = null;

  constructor(private readonly key: CommandIntentKey, private readonly store?: ReceiptStore) {}

  readonly getSnapshot = () => this.status;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(status: PendingCommandStatus) {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.listeners) listener();
  }

  private receiptKey(): readonly [kind: string, resourceId: string] {
    const separator = this.key.indexOf("#");
    return [this.key.slice(0, separator), this.key.slice(separator + 1)];
  }

  hydrate(): Promise<void> {
    if (!this.store || this.loaded) return Promise.resolve();
    return this.hydration ??= this.store.getOnlineReceipt(...this.receiptKey()).then((receipt) => {
      if (this.loaded) return;
      this.loaded = true;
      if (receipt) this.pending = { id: receipt.operationId, receipt };
      if (!this.inFlight && this.pending) this.publish("checking");
    }, () => {}).finally(() => { this.hydration = null; });
  }

  run(
    inputKey: string, proposedId: string, requestedId: string | undefined, available: () => boolean,
    send: (operationId: string) => Promise<ApiResult<Data>>,
  ): Promise<ApiResult<Data>> {
    const running = this.inFlight;
    if (running) return running.inputKey === inputKey && running.requestedId === requestedId
      ? running.promise : Promise.resolve(requestUncertain);
    const promise = Promise.resolve().then(async () => {
      if (!available()) {
        await this.hydrate();
        return this.pending?.uncertain ?? (this.pending ? requestUncertain : requestNotSent);
      }

      let pending = this.pending;
      let existing = pending !== null;
      if (!pending && this.store) {
        const claimed = await this.store.claimOnlineReceipt(...this.receiptKey(), proposedId);
        this.loaded = true;
        existing = claimed.existing;
        pending = { id: claimed.receipt.operationId, receipt: claimed.receipt };
        this.pending = pending;
      }
      if (pending && ((pending.inputKey !== undefined && pending.inputKey !== inputKey) ||
        (requestedId !== undefined && pending.id !== requestedId))) {
        // Do not turn a still-unresolved operation into a different mutation.
        return pending.uncertain ?? requestUncertain;
      }
      pending ??= { id: proposedId };
      this.pending = pending;
      let outcome: ApiResult<Data> = requestNotSent;
      if (available()) {
        try { outcome = await send(pending.id); }
        catch { outcome = requestUncertain; }
      }
      if (commandSnapshot(outcome).state === "checking") {
        pending.inputKey = inputKey;
        pending.uncertain = outcome;
      } else if (existing && !outcome.ok && "delivery" in outcome.error && outcome.error.delivery === "not_sent") {
        return pending.uncertain ?? requestUncertain;
      } else {
        if (pending.receipt) {
          // Keep the durable reference if cleanup failed; don't misreport a definitive server result.
          try { await this.store!.removeOnlineReceipt(pending.receipt); }
          catch { return outcome; }
        }
        this.pending = null;
      }
      return outcome;
    }).catch(() => this.pending?.uncertain ?? (this.pending ? requestUncertain : requestNotSent)).finally(() => {
      this.inFlight = null;
      this.publish(this.pending ? "checking" : "idle");
    });
    this.inFlight = { inputKey, requestedId, promise };
    this.publish("sending");
    return promise;
  }
}

interface ScopeRequests {
  reads: Map<string, RemoteRead<unknown>>;
  commands: Map<CommandIntentKey, CommandIntent<unknown>>;
}

// One bearer lifetime, partitioned again by the active scoped repository lease.
export class RequestBook {
  active = true;
  private readonly scopes = new WeakMap<object, ScopeRequests>();
  private readonly routes = new WeakMap<object, number>();
  private nextRoute = 0;

  constructor(readonly authenticated: boolean) {}

  allows(auth: AuthScope, context: { readonly isActive: boolean } | null): boolean {
    return this.active && context?.isActive !== false
      && (auth !== "context" || context?.isActive === true)
      && (this.authenticated || auth === "public" || auth === "challenge" || auth === "optional-session");
  }

  private scope(owner: object): ScopeRequests {
    let bucket = this.scopes.get(owner);
    if (!bucket) this.scopes.set(owner, bucket = { reads: new Map(), commands: new Map() });
    return bucket;
  }

  read<Data>(owner: object, route: object, input: string): RemoteRead<Data> {
    let routeId = this.routes.get(route);
    if (routeId === undefined) this.routes.set(route, routeId = this.nextRoute++);
    const key = `${routeId}:${input}`;
    const { reads } = this.scope(owner);
    const entry = reads.get(key) ?? new RemoteRead();
    reads.delete(key);
    reads.set(key, entry);
    if (reads.size > maxReadKeys) reads.delete(reads.keys().next().value!);
    // Entries are keyed by the exact route definition, which owns the data type.
    return entry as RemoteRead<Data>;
  }

  seedRead<Input extends RequestSchema, Output extends ResponseSchema>(
    context: { readonly isActive: boolean } | null, route: RouteDefinition<Input, Output> & { method: "GET" },
    input: unknown, data: unknown, serverTime: number, fence: ReadFence,
  ): { data: RouteResponse<Output> } | null {
    if (!this.allows(route.auth, context) || fence.offline || !Number.isSafeInteger(serverTime)) return null;
    const key = remoteRequestKey(route, input);
    if (key === null) return null;
    const parsed = route.output.safeParse(data);
    if (!parsed.success) return null;
    const entry = this.read<RouteResponse<Output>>(context ?? this, route, key);
    return entry.seed(parsed.data, serverTime, fence) ? { data: parsed.data } : null;
  }

  command<Data>(context: ReceiptStore | null, key: CommandIntentKey): CommandIntent<Data> {
    const { commands } = this.scope(context ?? this);
    let intent = commands.get(key);
    if (!intent) commands.set(key, intent = new CommandIntent(key, context ?? undefined));
    return intent as CommandIntent<Data>;
  }
}
