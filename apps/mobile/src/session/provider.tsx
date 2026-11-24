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
import { lockMobileRepository, openMobileRepository, openSignOutRepository, removeStagedFiles } from "../repository/open";
import type { RepositoryOpening } from "../repository/open-policy";
import type { MobileRepository, PendingWork, ScopedRepository } from "../repository/repository";
import { SyncProvider } from "../sync/provider";
import { SyncRunner } from "../sync/runner";
import { disablePushForSignedOutAccount, lockPushForSignedOutAccount } from "../system/push";
import { cardRemovalReporter, cardScope } from "../system/status-cards/controller";
import { expireOfflineView, readUnlockedSession, sessionView, watchBackgroundLock } from "./lifecycle";
import type { SessionView } from "./lifecycle";
import { contextSummarySchema, offlineWindow, projectOfflineBootstrap } from "./offline-bootstrap";
import { beginSignOut, parseStoredSession, sendRevocation, settleSignOut } from "./sign-out";
import type { ActiveSession, Disposition, SignOutProgress } from "./sign-out";
import { sessionStorage } from "./storage";

interface SessionState extends SessionView {
  status: "loading" | "ready" | "storage_error";
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
  const [viewGeneration, setViewGeneration] = useState(0);
  const [schedule] = useState(serialize);
  const repo = useRef<MobileRepository | null>(null);
  const activeScope = useRef<ScopedRepository | null>(null);
  const scopeSessionId = useRef<string | null>(null);
  const current = useRef<ActiveSession | null>(null);
  const locked = useRef<ActiveSession | null>(null);
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

  const repository = useCallback(async (requiresUnlock = false): Promise<RepositoryOpening<MobileRepository>> => {
    if (repo.current && (!requiresUnlock || repo.current.persistentAuthoring)) return { status: "open", repository: repo.current };
    const prompt = createMobileTranslator(promptLocale.current).t("mobile.you.unlockOfflineWork");
    const opened = await openMobileRepository(prompt, requiresUnlock);
    if (opened.status === "open") repo.current = opened.repository;
    return opened;
  }, []);

  const closeScope = useCallback(() => {
    const previous = activeScope.current;
    if (!previous) return;
    activeScope.current = null;
    scopeSessionId.current = null;
    previous.close();
    runner.cancel(previous);
    setScope(null);
  }, [runner]);

  const adopt = useCallback((record: ActiveSession | null, view: SessionView = signedOut) => {
    const { session, preferences } = view;
    const context = session?.activeContext;
    if (scopeSessionId.current !== (session?.sessionId ?? null) || activeScope.current?.scope.accountId !== session?.accountId ||
        activeScope.current?.scope.contextId !== context?.contextId) {
      closeScope();
      if (repo.current && session && context) {
        const card = cardScope(session);
        const opened = repo.current.openScope({ accountId: session.accountId, contextId: context.contextId }, context.role,
          card ? cardRemovalReporter(card.key) : undefined);
        activeScope.current = opened;
        scopeSessionId.current = session.sessionId;
        setScope(opened);
      }
    }
    bindSession(session ? record?.credential ?? null : null, session?.sessionId ?? null, preferences?.uiLocale ?? null, context?.contextId ?? null);
    setState({ ...view, status: "ready" });
  }, [bindSession, closeScope]);

  const restoreStored = useCallback(async (stored: ActiveSession, live: () => boolean, relocking = false) => {
    const restored = await readUnlockedSession(stored, requiresUnlock => repository(requiresUnlock || relocking));
    if (!live()) return;
    if (!restored || "ending" in restored) {
      if (restored) {
        // Settlement resumes after this serialized restore, including while offline.
        ending.current = restored.ending;
        lockPushForSignedOutAccount(stored.session.accountId);
      }
      current.current = null;
      confirmed.current = false;
      adopt(null);
      return;
    }
    const { record, cached } = restored;
    current.current = record;
    if (cached) adopt(record, sessionView({ ...record.session, activeContext: cached.activeContext }, null, cached));
    else adopt(null);
  }, [adopt, repository]);

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
    const opened = await repository(sameSession && previous.requiresUnlock);
    if (opened.status !== "open" || ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    const db = opened.repository;
    const offlineBootstrap = projectOfflineBootstrap(bootstrap, Date.now());
    if (offlineBootstrap) await db.saveOfflineBootstrap(account.id, offlineBootstrap);
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    const session = { accountId: account.id, sessionId, setup, expiresAt, activeContext };
    const record: ActiveSession = { state: "active", requiresUnlock: db.persistentAuthoring, credential: token, proof,
      session: { ...session, activeContext: activeContext && contextSummarySchema.parse(activeContext) } };
    const encoded = JSON.stringify(record);
    if (encoded !== JSON.stringify(previous)) await sessionStorage.save(encoded);
    if (ending.current || epoch.current !== generation) throw new Error("The local session is locked");
    current.current = record;
    locked.current = null;
    confirmed.current = true;
    adopt(record, sessionView(session, { ...fields, account, activeContext, sessionId, setup, expiresAt }, offlineBootstrap));
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
          return sendRevocation(api, revocation);
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
        adopt(null);
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
          adopt(null);
          await sessionStorage.remove();
          await repo.current?.sealAccount(accountId);
        } else if (!activeScope.current) adopt(null);
      });
    }).catch(() => { if (!abort.signal.aborted && !ending.current && !activeScope.current) adopt(null); })
      .finally(() => {
        if (restoreAbort.current === abort) {
          restoreFlight.current = null;
          restoreAbort.current = null;
        }
      });
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
        const generation = epoch.current;
        await restoreStored(stored, () => live && epoch.current === generation);
        return;
      } else if (stored) await sessionStorage.remove();
      if (live) adopt(null);
    }).then(() => { if (live) resume(); }, () => { if (live) setState({ ...signedOut, status: "storage_error" }); });
    return () => { live = false; closeScope(); };
  }, [adopt, closeScope, cookieSession, restoreStored, resume, schedule]);

  useEffect(() => {
    if (!connection.offline && inForeground()) resume();
  }, [connection.offline, resume]);
  useEffect(() => {
    let live = true;
    const lock = watchBackgroundLock(() => {
      lockMobileRepository();
      if (!repo.current?.persistentAuthoring) return;
      repo.current = null;
      if (ending.current) return;
      locked.current = current.current;
      current.current = null;
      confirmed.current = false;
      epoch.current++;
      restoreAbort.current?.abort();
      restoreAbort.current = null;
      restoreFlight.current = null;
      adopt(null);
      setViewGeneration((value) => value + 1);
    });
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") lock.background();
      if (next !== "active") return;
      lock.foreground();
      const stored = locked.current;
      if (!stored) { resume(); return; }
      // Try only once per foreground entry. A cancelled prompt cannot
      // be retried by reconnects or rebind the saved bearer.
      locked.current = null;
      const generation = epoch.current;
      const valid = () => live && !ending.current && epoch.current === generation && !current.current;
      void schedule(async () => {
        if (!valid()) return;
        if (stored.session.expiresAt <= Date.now()) { await sessionStorage.remove(); return; }
        await restoreStored(stored, valid, true);
      }).then(() => { if (live) resume(); }, () => { if (valid()) setState({ ...signedOut, status: "storage_error" }); });
    });
    if (AppState.currentState === "background") lock.background();
    return () => { live = false; lock.dispose(); subscription.remove(); };
  }, [adopt, restoreStored, resume, schedule]);

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
        adopt(null);
        void schedule(() => sessionStorage.remove()).catch(() => setState({ ...signedOut, status: "storage_error" }));
        return;
      }
      if (offlineExpiry !== null && offlineExpiry <= now) {
        const record = current.current;
        if (record?.session.sessionId !== session.sessionId || ending.current) return;
        adopt(record, expireOfflineView(confirmed.current ? session : null));
        setViewGeneration((value) => value + 1);
        confirmed.current = false;
        void refreshSession();
        return;
      }
      timer = setTimeout(check, Math.min(Math.min(offlineExpiry ?? Infinity, session.expiresAt) - now, 2 ** 31 - 1));
    };
    check();
    const subscription = AppState.addEventListener("change", (next) => { if (next === "active") check(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [state.session, state.offlineBootstrap, adopt, refreshSession, schedule]);

  const inspectPendingWork = useCallback(async () => {
    const account = current.current?.session.accountId;
    const db = repo.current;
    if (!account || !db || ending.current) throw new Error("No active account");
    return db.pendingWork(account);
  }, []);

  const signOut = useCallback((disposition: Disposition) => {
    const record = current.current;
    if (!record) return Promise.resolve();
    ending.current = beginSignOut(record, { disposition, persistent: repo.current?.persistentAuthoring ?? false });
    epoch.current++;
    restoreAbort.current?.abort();
    current.current = null;
    confirmed.current = false;
    lockPushForSignedOutAccount(record.session.accountId);
    adopt(null);
    return advanceEnding();
  }, [adopt, advanceEnding]);

  const access = useMemo<SessionAccess>(() => ({ ...state, bootstrap: connection.offline ? null : state.bootstrap,
    acceptBootstrap, refreshSession, inspectPendingWork, persistentWork: repo.current?.persistentAuthoring ?? false, signOut }),
    [state, connection.offline, acceptBootstrap, refreshSession, inspectPendingWork, signOut]);
  return (
    <SessionContext.Provider value={access}>
      {/* Paged lists and forms can retain private data outside the repository hooks. */}
      <RepositoryProvider key={viewGeneration} repository={scope}>
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
