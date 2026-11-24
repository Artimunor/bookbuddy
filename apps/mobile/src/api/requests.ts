import type { ApiResult, RequestOptions } from "@bookbuddy/api-client";
import type { AuthScope } from "@bookbuddy/api-contract";

export type ApiError = Extract<ApiResult<never>, { ok: false }>["error"];
export type RemoteStatus = "idle" | "loading" | "ready" | "error" | "offline";
export type CommandStatus = "idle" | "sending" | "done" | "conflict" | "checking" | "failed";
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

  seed(data: Data, serverTime: number, fence: ReadFence): void {
    if (fence.offline) return;
    if (this.snapshot.status === "ready" && this.fence && sameReadGeneration(this.fence, fence) &&
      this.snapshot.lastConfirmedAt > serverTime) return;
    this.inFlight?.abort.abort();
    this.inFlight = null;
    this.fence = fence;
    this.confirmedAt = this.now();
    this.publish({ status: "ready", data, error: null, lastConfirmedAt: serverTime });
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

export class CommandIntents<Data> {
  private readonly entries = new Map<string, { id: string; inFlight: Promise<ApiResult<Data>> | null; uncertain: ApiResult<Data> | null }>();

  run(key: string, newId: () => string, send: (operationId: string) => Promise<ApiResult<Data>>): Promise<ApiResult<Data>> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { id: newId(), inFlight: null, uncertain: null };
      this.entries.set(key, entry);
    }
    if (entry.inFlight) return entry.inFlight;
    const intent = entry;
    const flight = Promise.resolve().then(() => send(intent.id)).catch(() => requestUncertain).then((outcome) => {
      intent.inFlight = null;
      if (outcome.ok) this.entries.delete(key);
      else if ("delivery" in outcome.error && outcome.error.delivery === "not_sent" && intent.uncertain) return intent.uncertain;
      else intent.uncertain = commandSnapshot(outcome).state === "checking" ? outcome : null;
      return outcome;
    });
    intent.inFlight = flight;
    return flight;
  }
}

interface ScopeRequests {
  reads: Map<string, RemoteRead<unknown>>;
  commands: WeakMap<object, CommandIntents<unknown>>;
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
    if (!bucket) this.scopes.set(owner, bucket = { reads: new Map(), commands: new WeakMap() });
    return bucket;
  }

  read<Data>(owner: object, route: object, input: string): RemoteRead<Data> {
    let routeId = this.routes.get(route);
    if (routeId === undefined) this.routes.set(route, routeId = this.nextRoute++);
    const key = `${routeId}:${input}`;
    const { reads } = this.scope(owner);
    const cached = reads.get(key);
    const entry = cached && !cached.stale ? cached : new RemoteRead();
    reads.delete(key);
    reads.set(key, entry);
    if (reads.size > maxReadKeys) reads.delete(reads.keys().next().value!);
    // Entries are keyed by the exact route definition, which owns the data type.
    return entry as RemoteRead<Data>;
  }

  commands<Data>(owner: object, route: object): CommandIntents<Data> {
    const { commands } = this.scope(owner);
    let intents = commands.get(route);
    if (!intents) commands.set(route, intents = new CommandIntents());
    return intents as CommandIntents<Data>;
  }
}
