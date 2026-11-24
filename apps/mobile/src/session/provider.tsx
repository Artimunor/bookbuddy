import { createAuthClient, sync } from "@bookbuddy/api-client";
import { authTokenPattern, sessionRevocationProofSchema } from "@bookbuddy/api-contract";
import type { SessionBootstrap } from "@bookbuddy/api-contract";
import { createMobileTranslator } from "@bookbuddy/i18n/mobile";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AppState } from "react-native";
import { useApiAccess } from "../api/provider";
import { serialize } from "../repository/executor";
import { RepositoryProvider } from "../repository/hooks";
import { openMobileRepository, openSignOutRepository, removeStagedFiles } from "../repository/open";
import type { DevicePreferences, MobileRepository, PendingWork, ScopedRepository } from "../repository/repository";
import { SyncProvider } from "../sync/provider";
import { SyncRunner } from "../sync/runner";
import { disablePushForSignedOutAccount, lockPushForSignedOutAccount } from "../system/push";
import { contextSummarySchema, offlineWindow, projectOfflineBootstrap } from "./offline-bootstrap";
import type { OfflineBootstrap } from "./offline-bootstrap";
import { beginSignOut, parseStoredSession, settleSignOut } from "./sign-out";
import type { ActiveSession, DeviceSession, Disposition, SignOutProgress } from "./sign-out";
import { sessionStorage } from "./storage";

interface SessionState {
  status: "loading" | "ready" | "storage_error";
  session: DeviceSession | null;
  bootstrap: SessionBootstrap | null;
  offlineBootstrap: OfflineBootstrap | null;
  preferences: DevicePreferences | null;
}
export interface SessionAccess extends SessionState {
  acceptBootstrap: (bootstrap: SessionBootstrap, credential?: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  inspectPendingWork: () => Promise<PendingWork>;
  persistentWork: boolean;
  signOut: (disposition: Disposition) => Promise<void>;
}
const initialState: SessionState = { status: "loading", session: null, bootstrap: null, offlineBootstrap: null, preferences: null };
const signedOut: SessionState = { ...initialState, status: "ready" };
const SessionContext = createContext<SessionAccess | null>(null);
const inForeground = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";

export function SessionProvider({ children }: { children: ReactNode }) {
  const { bindSession, client, connection, cookieSession, getConnection, locale } = useApiAccess();
  const [state, setState] = useState<SessionState>(initialState);
  const [scope, setScope] = useState<ScopedRepository | null>(null);
  const [schedule] = useState(serialize);
  const repo = useRef<MobileRepository | null>(null);
  const activeScope = useRef<ScopedRepository | null>(null);
  const current = useRef<ActiveSession | null>(null);
  const confirmed = useRef(false);
  const ending = useRef<SignOutProgress | null>(null);
  const endingFlight = useRef<Promise<void> | null>(null);
  const restoreFlight = useRef<Promise<void> | null>(null);
  const restoreAbort = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const liveClient = useRef(client);
  const promptLocale = useRef(locale);
  useEffect(() => { liveClient.current = client; promptLocale.current = locale; }, [client, locale]);
  const [runner] = useState(() => new SyncRunner((request, signal) => {
    const api = liveClient.current;
    return api ? sync(api, request, { signal }) : Promise.resolve({ ok: false, error: { code: "REQUEST_SETUP_FAILED", delivery: "not_sent" } });
  }));

  const repository = useCallback(async () => {
    if (!repo.current) {
      const prompt = createMobileTranslator(promptLocale.current).t("mobile.you.unlockOfflineWork");
      repo.current = await openMobileRepository(prompt);
    }
    return repo.current;
  }, []);

  const closeScope = useCallback(() => {
    const previous = activeScope.current;
    if (!previous) return;
    activeScope.current = null;
    previous.close();
    runner.cancel(previous);
    setScope(null);
  }, [runner]);

  const adopt = useCallback((record: ActiveSession | null, session: DeviceSession | null, bootstrap: SessionBootstrap | null, offlineBootstrap: OfflineBootstrap | null) => {
    const context = session?.activeContext;
    if (activeScope.current?.scope.accountId !== session?.accountId || activeScope.current?.scope.contextId !== context?.contextId) {
      closeScope();
      if (repo.current && session && context) {
        const opened = repo.current.openScope({ accountId: session.accountId, contextId: context.contextId }, context.role);
        activeScope.current = opened;
        setScope(opened);
      }
    }
    const preferences = bootstrap?.preferences ?? offlineBootstrap?.preferences ?? null;
    bindSession(session ? record?.credential ?? null : null, session?.sessionId ?? null, preferences?.uiLocale ?? null, context?.contextId ?? null);
    setState({ status: "ready", session, bootstrap, offlineBootstrap, preferences });
  }, [bindSession, closeScope]);

  const applyBootstrap = useCallback(async (bootstrap: SessionBootstrap, generation: number, credential?: string) => {
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    const { account, activeContext, sessionId, setup, expiresAt, revocationProof, ...fields } = bootstrap;
    const previous = current.current;
    if (previous && previous.session.accountId !== account.id) throw new Error("Sign out before changing accounts");
    const sameSession = previous?.session.sessionId === sessionId;
    if (!sameSession && !cookieSession && credential === undefined) throw new Error("The session changed");
    const token = cookieSession ? null : credential ?? (sameSession ? previous.credential : null);
    const proof = cookieSession ? null : revocationProof ?? (sameSession ? previous.proof : null);
    const valid = cookieSession ? credential === undefined : token !== null && authTokenPattern.test(token)
      && sessionRevocationProofSchema.safeParse(proof).success;
    if (!valid || expiresAt <= Date.now()) throw new Error("A valid session for this transport is required");
    const db = await repository();
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    const offlineBootstrap = projectOfflineBootstrap(bootstrap, Date.now());
    if (offlineBootstrap) await db.saveOfflineBootstrap(account.id, offlineBootstrap);
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    const session = { accountId: account.id, sessionId, setup, expiresAt, activeContext };
    const record: ActiveSession = { state: "active", credential: token, proof,
      session: { ...session, activeContext: activeContext && contextSummarySchema.parse(activeContext) } };
    const encoded = JSON.stringify(record);
    if (encoded !== JSON.stringify(previous)) await sessionStorage.save(encoded);
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    current.current = record;
    confirmed.current = true;
    adopt(record, session, { ...fields, account, activeContext, sessionId, setup, expiresAt }, offlineBootstrap);
  }, [adopt, cookieSession, repository]);

  const acceptBootstrap = useCallback((bootstrap: SessionBootstrap, credential?: string) => {
    const generation = epoch.current;
    return schedule(() => applyBootstrap(bootstrap, generation, credential));
  }, [applyBootstrap, schedule]);

  const advanceEnding = useCallback(() => {
    const progress = ending.current;
    if (!progress) return Promise.resolve();
    if (endingFlight.current) return endingFlight.current;
    const flight = schedule(async () => {
      const api = liveClient.current;
      const settled = await settleSignOut(progress, {
        save: (intent) => sessionStorage.save(JSON.stringify(intent)), remove: sessionStorage.remove,
        finalizeLocal: async ({ accountId, disposition, persistent }) => {
          await disablePushForSignedOutAccount(accountId);
          const db = await openSignOutRepository(persistent);
          if (disposition === "keep") await db.sealAccount(accountId);
          else await db.wipeAccount(accountId, removeStagedFiles);
        },
        revoke: api ? async (revocation) => {
          if (!inForeground() || getConnection().offline) return false;
          const abort = new AbortController();
          const timeout = setTimeout(() => abort.abort(), 15_000);
          const auth = createAuthClient(api);
          try {
            if (revocation.mode === "native") {
              const result = await auth.revoke({ sessionId: revocation.sessionId, proof: revocation.proof }, { signal: abort.signal });
              return result.ok && result.data.ended;
            }
            const { sessionId, contextId } = revocation;
            const result = await auth.end({ expectedCookieIdentity: { sessionId, contextId }, signal: abort.signal });
            return result.ok || result.error.code === "UNAUTHENTICATED";
          } finally { clearTimeout(timeout); }
        } : undefined,
      });
      if (settled) ending.current = null;
      setState(signedOut);
    }).catch(() => { setState({ ...signedOut, status: "storage_error" }); })
      .finally(() => { endingFlight.current = null; });
    endingFlight.current = flight;
    return flight;
  }, [getConnection, schedule]);

  const refreshSession = useCallback(() => {
    if (restoreFlight.current) return restoreFlight.current;
    const abort = new AbortController();
    restoreAbort.current = abort;
    const flight = Promise.resolve().then(async () => {
      const record = current.current;
      const api = liveClient.current;
      if (!record || confirmed.current || ending.current || !api || !inForeground() || getConnection().offline) return;
      const generation = epoch.current;
      const { sessionId, accountId, activeContext, expiresAt } = record.session;
      if (expiresAt <= Date.now()) {
        current.current = null;
        adopt(null, null, null, null);
        await schedule(() => sessionStorage.remove());
        return;
      }
      bindSession(record.credential, sessionId, null, activeContext?.contextId ?? null);
      const result = await createAuthClient(api).getSession({ signal: abort.signal });
      await schedule(async () => {
        if (abort.signal.aborted || epoch.current !== generation || current.current !== record) return;
        if (result.ok && result.data.sessionId === sessionId && result.data.account.id === accountId) {
          await applyBootstrap(result.data, generation);
          return;
        }
        if (result.ok || result.error.code === "UNAUTHENTICATED" || result.error.code === "NOT_FOUND") {
          current.current = null;
          adopt(null, null, null, null);
          await sessionStorage.remove();
          await repo.current?.sealAccount(accountId);
        } else if (!activeScope.current) adopt(null, null, null, null);
      });
    }).catch(() => { if (!abort.signal.aborted && !ending.current && !activeScope.current) adopt(null, null, null, null); })
      .finally(() => { restoreFlight.current = null; restoreAbort.current = null; });
    restoreFlight.current = flight;
    return flight;
  }, [adopt, applyBootstrap, bindSession, getConnection, schedule]);

  const resume = useCallback(() => {
    if (ending.current) void advanceEnding();
    else if (current.current && !confirmed.current) void refreshSession();
  }, [advanceEnding, refreshSession]);

  useEffect(() => {
    let live = true;
    void schedule(async () => {
      const raw = await sessionStorage.read();
      if (!live) return;
      const stored = raw === null ? null : parseStoredSession(raw, cookieSession);
      if (stored?.state === "ending") {
        ending.current = { intent: stored, persisted: true };
        lockPushForSignedOutAccount(stored.accountId);
      } else if (stored && stored.session.expiresAt > Date.now()) {
        const { accountId, sessionId, activeContext } = stored.session;
        const db = await repository();
        if (!live) return;
        current.current = stored;
        const cached = activeContext && await db.getOfflineBootstrap(accountId, sessionId, activeContext.contextId);
        if (!live) return;
        if (cached && cached.activeContext.role === activeContext?.role) {
          adopt(stored, { ...stored.session, activeContext: cached.activeContext }, null, cached);
          return;
        }
      } else if (stored) await sessionStorage.remove();
      if (live) adopt(null, null, null, null);
    }).then(() => { if (live) resume(); }, () => { if (live) setState({ ...signedOut, status: "storage_error" }); });
    return () => { live = false; closeScope(); };
  }, [adopt, closeScope, cookieSession, repository, resume, schedule]);

  useEffect(() => {
    if (!connection.offline && inForeground()) resume();
  }, [connection.offline, resume]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") resume(); });
    return () => subscription.remove();
  }, [resume]);

  useEffect(() => {
    const session = state.session;
    if (!session) return;
    const offlineExpiry = state.offlineBootstrap && state.offlineBootstrap.authorizedAt + offlineWindow;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const now = Date.now();
      if (session.expiresAt <= now) {
        const id = session.sessionId;
        if (current.current?.session.sessionId !== id || ending.current) return;
        current.current = null;
        confirmed.current = false;
        epoch.current++;
        adopt(null, null, null, null);
        void schedule(() => sessionStorage.remove()).catch(() => setState({ ...signedOut, status: "storage_error" }));
        return;
      }
      if (offlineExpiry !== null && offlineExpiry <= now) {
        if (confirmed.current) setState((previous) => ({ ...previous, offlineBootstrap: null }));
        else adopt(null, null, null, null);
        return;
      }
      timer = setTimeout(check, Math.min(Math.min(offlineExpiry ?? Infinity, session.expiresAt) - now, 2 ** 31 - 1));
    };
    check();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") check(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [state.session, state.offlineBootstrap, adopt, schedule]);

  const inspectPendingWork = useCallback(async () => {
    const account = current.current?.session.accountId;
    const db = repo.current;
    if (!account || !db || ending.current) throw new Error("No active account");
    return db.pendingWork(account);
  }, []);

  const signOut = useCallback((disposition: Disposition) => {
    const record = current.current;
    if (!record) return Promise.resolve();
    ending.current = beginSignOut(record, disposition, repo.current?.persistentAuthoring ?? false);
    epoch.current++;
    restoreAbort.current?.abort();
    current.current = null;
    confirmed.current = false;
    lockPushForSignedOutAccount(record.session.accountId);
    adopt(null, null, null, null);
    return advanceEnding();
  }, [adopt, advanceEnding]);

  const access = useMemo<SessionAccess>(() => ({ ...state, bootstrap: connection.offline ? null : state.bootstrap,
    acceptBootstrap, refreshSession, inspectPendingWork, persistentWork: repo.current?.persistentAuthoring ?? false, signOut }),
    [state, connection.offline, acceptBootstrap, refreshSession, inspectPendingWork, signOut]);
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
