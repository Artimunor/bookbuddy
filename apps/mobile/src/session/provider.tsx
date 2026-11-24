import { sync } from "@bookbuddy/api-client";
import { accountIdSchema, authTokenPattern, sessionBootstrapSchema, sessionEndRoute } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { useApiAccess } from "../api/provider";
import { serialize } from "../repository/executor";
import { RepositoryProvider } from "../repository/hooks";
import { openMobileRepository, removeStagedFiles } from "../repository/open";
import type { DevicePreferences, MobileRepository, ScopedRepository } from "../repository/repository";
import { SyncProvider } from "../sync/provider";
import { SyncRunner } from "../sync/runner";
import { sessionStorage } from "./storage";

const deviceSessionSchema = sessionBootstrapSchema.pick({ sessionId: true, expiresAt: true, setup: true, activeContext: true })
  .extend({ accountId: accountIdSchema });
export type DeviceSession = Pick<SessionBootstrap, "sessionId" | "expiresAt" | "setup" | "activeContext"> & { accountId: SessionBootstrap["account"]["id"] };
type StoredSession = { state: "active"; credential: string; session: DeviceSession } | { state: "ending"; accountId: DeviceSession["accountId"] };
interface SessionState {
  status: "loading" | "ready" | "storage_error";
  session: DeviceSession | null;
  bootstrap: SessionBootstrap | null;
  preferences: DevicePreferences | null;
}
export interface SessionAccess extends SessionState {
  acceptBootstrap: (bootstrap: SessionBootstrap, credential?: string) => Promise<void>;
  signOut: () => Promise<void>;
}
const initialState: SessionState = { status: "loading", session: null, bootstrap: null, preferences: null };
const signedOut: SessionState = { ...initialState, status: "ready" };
const SessionContext = createContext<SessionAccess | null>(null);

function parseStoredSession(raw: string): StoredSession {
  const value: unknown = JSON.parse(raw);
  if (value && typeof value === "object" && "state" in value) {
    if (value.state === "ending" && "accountId" in value) return { state: "ending", accountId: accountIdSchema.parse(value.accountId) };
    if (value.state === "active" && "credential" in value && typeof value.credential === "string" && authTokenPattern.test(value.credential) && "session" in value) {
      return { state: "active", credential: value.credential, session: deviceSessionSchema.parse(value.session) };
    }
  }
  throw new Error("Invalid saved session");
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { bindSession, client } = useApiAccess();
  const [state, setState] = useState<SessionState>(initialState);
  const [scope, setScope] = useState<ScopedRepository | null>(null);
  const [schedule] = useState(serialize);
  const repo = useRef<MobileRepository | null>(null);
  const activeScope = useRef<ScopedRepository | null>(null);
  const current = useRef<Extract<StoredSession, { state: "active" }> | null>(null);
  const currentPreferences = useRef<DevicePreferences | null>(null);
  const ending = useRef<DeviceSession["accountId"] | null>(null);
  const liveClient = useRef(client);
  useEffect(() => { liveClient.current = client; }, [client]);
  const [runner] = useState(() => new SyncRunner((request, signal) => {
    const api = liveClient.current;
    return api ? sync(api, request, { signal }) : Promise.resolve({ ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } });
  }));

  const closeScope = useCallback(() => {
    if (!activeScope.current) return;
    const previous = activeScope.current;
    activeScope.current = null;
    previous.close();
    runner.cancel(previous);
    setScope(null);
  }, [runner]);

  const adopt = useCallback((record: typeof current.current, preferences: DevicePreferences | null, bootstrap: SessionBootstrap | null) => {
    const next = record?.session ?? null;
    const contextId = next?.activeContext?.contextId;
    if (activeScope.current?.scope.accountId !== next?.accountId || activeScope.current?.scope.contextId !== contextId) {
      closeScope();
      if (repo.current && next && contextId) {
        const opened = repo.current.openScope({ accountId: next.accountId, contextId });
        activeScope.current = opened;
        setScope(opened);
      }
    }
    current.current = record;
    currentPreferences.current = preferences;
    bindSession(record?.credential ?? null, preferences?.uiLocale ?? null);
    setState({ status: "ready", session: next, preferences, bootstrap });
  }, [bindSession, closeScope]);

  useEffect(() => {
    let live = true;
    void schedule(async () => {
      const db = await openMobileRepository();
      const raw = await sessionStorage.read();
      if (!live) return;
      repo.current = db;
      const stored = raw === null ? null : parseStoredSession(raw);
      if (stored?.state === "ending") {
        ending.current = stored.accountId;
        await db.wipeAccount(stored.accountId, removeStagedFiles);
        await sessionStorage.remove();
        ending.current = null;
      } else if (stored && stored.session.expiresAt > Date.now()) {
        const preferences = await db.getLocalePreferences(stored.session.accountId);
        if (live) adopt(stored, preferences, null);
        return;
      } else if (stored) await sessionStorage.remove();
      if (live) adopt(null, null, null);
    }).catch(() => { if (live) setState({ ...signedOut, status: "storage_error" }); });
    return () => { live = false; closeScope(); };
  }, [adopt, closeScope, schedule]);

  useEffect(() => {
    const session = state.session;
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = session.expiresAt - Date.now();
      if (remaining > 0) {
        timer = setTimeout(check, Math.min(remaining, 2 ** 31 - 1));
        return;
      }
      void schedule(async () => {
        if (current.current?.session !== session) return;
        adopt(null, null, null);
        await sessionStorage.remove();
      }).catch(() => { setState({ ...signedOut, status: "storage_error" }); });
    };
    check();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") check(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [state.session, adopt, schedule]);

  const acceptBootstrap = useCallback((bootstrap: SessionBootstrap, credential?: string) => schedule(async () => {
    if (!repo.current || ending.current) throw new Error("Local session storage is unavailable");
    const { account, activeContext, sessionId, setup, expiresAt, preferences } = bootstrap;
    const previous = current.current;
    if (previous && previous.session.accountId !== account.id) throw new Error("Sign out before changing accounts");
    const token = credential ?? (previous?.session.sessionId === sessionId ? previous.credential : undefined);
    if (!token || !authTokenPattern.test(token) || expiresAt <= Date.now()) throw new Error("A valid native session credential is required");
    const session = deviceSessionSchema.parse({ accountId: account.id, sessionId, setup, expiresAt, activeContext });
    const record: Extract<StoredSession, { state: "active" }> = { state: "active", credential: token, session };
    const { revision: _revision, ...devicePreferences } = preferences;
    const prior = currentPreferences.current;
    if (prior?.uiLocale !== preferences.uiLocale || prior?.readingLocale !== preferences.readingLocale
      || prior?.theme !== preferences.theme || prior?.fieldMode !== preferences.fieldMode || prior?.twoClock !== preferences.twoClock) {
      await repo.current.saveLocalePreferences(account.id, devicePreferences);
    }
    const encoded = JSON.stringify(record);
    if (encoded !== JSON.stringify(previous)) await sessionStorage.save(encoded);
    adopt(record, devicePreferences, bootstrap);
  }), [adopt, schedule]);

  const signOut = useCallback(() => schedule(async () => {
    const accountId = current.current?.session.accountId ?? ending.current;
    if (!accountId || !repo.current) return;
    // Capture the bearer for this one explicit revocation before removing it from the client.
    if (current.current && client) void client.request(sessionEndRoute, {}).catch(() => undefined);
    adopt(null, null, null);
    ending.current = accountId;
    try {
      await sessionStorage.save(JSON.stringify({ state: "ending", accountId } satisfies StoredSession));
      await repo.current.wipeAccount(accountId, removeStagedFiles);
      await sessionStorage.remove();
      ending.current = null;
    } catch (error) {
      setState({ ...signedOut, status: "storage_error" });
      throw error;
    }
  }), [adopt, client, schedule]);

  const access = useMemo<SessionAccess>(() => ({ ...state, acceptBootstrap, signOut }), [state, acceptBootstrap, signOut]);
  return (
    <SessionContext.Provider value={access}>
      <RepositoryProvider repository={scope}>
        <SyncProvider runner={client ? runner : null} repository={scope}>{children}</SyncProvider>
      </RepositoryProvider>
    </SessionContext.Provider>
  );
}

export function useSession(): SessionAccess {
  const state = useContext(SessionContext);
  if (!state) throw new Error("SessionProvider is required");
  return state;
}
