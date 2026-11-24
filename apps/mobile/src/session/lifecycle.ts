import type { SessionBootstrap } from "@bookbuddy/api-contract";
import type { RepositoryOpening } from "../repository/open-policy";
import type { DevicePreferences, MobileRepository } from "../repository/repository";
import type { OfflineBootstrap } from "./offline-bootstrap";
import type { ActiveSession, DeviceSession } from "./sign-out";

export interface SessionView {
  session: DeviceSession | null;
  bootstrap: SessionBootstrap | null;
  offlineBootstrap: OfflineBootstrap | null;
  preferences: DevicePreferences | null;
}

export function sessionView(session: DeviceSession | null, bootstrap: SessionBootstrap | null = null,
  offlineBootstrap: OfflineBootstrap | null = null): SessionView {
  return { session, bootstrap, offlineBootstrap, preferences: bootstrap?.preferences ?? offlineBootstrap?.preferences ?? null };
}

export function expireOfflineView(session: DeviceSession | null): SessionView {
  return sessionView(session && { ...session, activeContext: null });
}

export async function readUnlockedSession(record: ActiveSession,
  open: (requiresUnlock: boolean) => Promise<RepositoryOpening<Pick<MobileRepository, "getOfflineBootstrap">>>,
  discardCredential: () => Promise<void>, now = Date.now) {
  const opened = await open(record.requiresUnlock);
  if (opened.status === "unavailable") await discardCredential();
  if (opened.status !== "open" || record.session.expiresAt <= now()) return null;
  const { accountId, sessionId, activeContext } = record.session;
  const cached = activeContext && await opened.repository.getOfflineBootstrap(accountId, sessionId, activeContext.contextId);
  if (record.session.expiresAt <= now()) return null;
  return { record, cached: cached && cached.activeContext.role === activeContext?.role ? cached : null };
}

const backgroundLimit = 5 * 60_000;

export function watchBackgroundLock(relock: () => void, now = Date.now) {
  let since: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dispose = () => { clearTimeout(timer); timer = undefined; since = undefined; };
  return {
    background() {
      if (since !== undefined) return;
      since = now();
      timer = setTimeout(() => { timer = undefined; relock(); }, backgroundLimit);
    },
    foreground() {
      // A suspended process may not have run the timer yet.
      const elapsed = since === undefined ? 0 : now() - since;
      if (timer !== undefined && (elapsed < 0 || elapsed >= backgroundLimit)) relock();
      dispose();
    },
    dispose,
  };
}
