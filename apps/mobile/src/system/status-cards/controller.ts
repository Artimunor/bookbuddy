import { requireOptionalNativeModule } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { uuid } from "expo";
import { AppState, Platform } from "react-native";
import type { ReportCardRemoval } from "../../repository/repository";
import type { DeviceSession } from "../../session";
import { localPreferenceStorage } from "../../i18n/storage";
import { cardExpiry, nativeCard, type CardCopy, type StatusCardSource, type StatusCardTarget } from "./model";
import { createCardStopJournal } from "./stop-journal";

interface StatusCardsNative {
  start(id: string, payload: string): Promise<boolean>;
  update(id: string, payload: string): Promise<boolean>;
  redact(id: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  /** End any activity other than the one verified against device preferences and the current scope. */
  clear(keeping: string | null): Promise<boolean>;
}
const bridge = Platform.OS === "ios" || Platform.OS === "android" ? requireOptionalNativeModule<StatusCardsNative>("BookBuddyStatusCards") : null;
const preferenceKey = "bookbuddy-status-cards-v1";
export type CardPreferences = { statusCardsEnabled: boolean; hideDetails: boolean; workerOptIn: boolean | null; coverOptIn: boolean };
export type CardScope = { key: string; expiresAt: number; role: "customer" | "worker" | "foreman" };
export type ActiveCard = { id: string; scopeKey: string; target: StatusCardTarget; expiresAt: number; stopPending?: true };
const defaults: CardPreferences = { statusCardsEnabled: false, hideDetails: true, workerOptIn: null, coverOptIn: false };
let state: { preferences: CardPreferences; preferenceScope: string | null; active: ActiveCard | null } = { preferences: defaults, preferenceScope: null, active: null };
let scope: CardScope | null | undefined;
let loaded = false;
let queue = Promise.resolve();
let expiry: ReturnType<typeof setTimeout> | undefined;
let applied: { source: StatusCardSource; copy: CardCopy; fingerprint: string } | null = null;
const listeners = new Set<() => void>();

function serialize<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action);
  queue = result.then(() => undefined, () => undefined);
  return result;
}

function publish(next: typeof state) {
  state = next;
  listeners.forEach(listener => listener());
}

async function hydrate() {
  if (loaded || !bridge) return;
  const raw = await localPreferenceStorage.read(preferenceKey);
  let saved: Partial<typeof state> = {};
  try { saved = raw ? JSON.parse(raw) ?? {} : {}; } catch { /* unreadable preferences fail closed */ }
  const prefs = saved.preferences;
  const active = saved.active;
  publish({
    preferences: {
      statusCardsEnabled: prefs?.statusCardsEnabled === true,
      hideDetails: prefs?.hideDetails !== false,
      workerOptIn: typeof prefs?.workerOptIn === "boolean" ? prefs.workerOptIn : null,
      coverOptIn: prefs?.coverOptIn === true,
    },
    preferenceScope: typeof saved.preferenceScope === "string" ? saved.preferenceScope : null,
    active: active?.target && typeof active.id === "string" && typeof active.scopeKey === "string" && Number.isSafeInteger(active.expiresAt) ? active : null,
  });
  loaded = true;
}

async function persist(next: typeof state) {
  await localPreferenceStorage.write(preferenceKey, JSON.stringify(next));
  publish(next);
}

const stopJournal = createCardStopJournal<ActiveCard>((active) => persist({ ...state, active }), (id) => bridge!.stop(id));

async function finishStop(card: ActiveCard) {
  await stopJournal.finish(card);
  applied = null;
  armExpiry(null);
}

export function cardRemovalReporter(expected: string): ReportCardRemoval | undefined {
  if (!bridge) return undefined;
  return (removed) => serialize(async () => {
    await hydrate();
    const card = state.active;
    if (!card || card.scopeKey !== expected || card.stopPending) return;
    const kind = card.target.kind === "worker_shift" ? "worker_field_shift" : card.target.kind === "session" ? "session_booking" : null;
    if (!await removed(kind, card.target.id)) return;
    await stopJournal.mark(card);
    // Only the durable mark is required to commit a sync page. Native work
    // runs on the same card queue and can be retried independently.
    void reconcileStatusCards().catch(() => undefined);
  });
}

function armExpiry(card: ActiveCard | null) {
  clearTimeout(expiry);
  if (card) expiry = setTimeout(() => { void reconcileStatusCards().catch(() => undefined); }, Math.max(0, card.expiresAt - Date.now()));
}

export function cardScope(session: DeviceSession | null): CardScope | null {
  const { role, contextId } = session?.activeContext ?? {};
  if (!session || (role !== "customer" && role !== "worker" && role !== "foreman")) return null;
  return { key: `${session.sessionId}:${session.accountId}:${contextId}`, role, expiresAt: session.expiresAt };
}

export function setStatusCardScope(next: CardScope | null | undefined) {
  scope = next;
  return reconcileStatusCards();
}

export function reconcileStatusCards() {
  return serialize(async () => {
    if (!bridge) return;
    try { await hydrate(); }
    catch (error) { await bridge.clear(null); throw error; }
    const pending = state.active?.stopPending ? state.active : null;
    if (pending) await finishStop(pending);
    if (scope === undefined) return;
    const { active, preferenceScope } = state;
    const key = scope?.key ?? null;
    const sameScope = key === preferenceScope;
    const keep = sameScope && state.preferences.statusCardsEnabled && active && scope?.key === active.scopeKey &&
      active.expiresAt > Date.now() && active.expiresAt <= scope.expiresAt ? active : null;
    if (!pending && await bridge.clear(keep?.id ?? null) && keep) { armExpiry(keep); return; }
    applied = null;
    armExpiry(null);
    if (active || (!sameScope && (preferenceScope !== null || state.preferences.statusCardsEnabled))) {
      // The pilot flag is device-local; another account or grant has not consented to this preview.
      const preferences = sameScope ? state.preferences : { ...defaults, statusCardsEnabled: state.preferences.statusCardsEnabled };
      await persist({ preferences, preferenceScope: key, active: null });
    }
  });
}

export function subscribeStatusCards(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function getStatusCards() { return state; }

export function setStatusCardPreferences(prefs: Partial<CardPreferences>, expectedScope?: string) {
  return serialize(async () => {
    if (!bridge) return;
    await hydrate();
    if (state.active?.stopPending) await finishStop(state.active);
    const key = scope?.key ?? null;
    // The internal pilot switch is device-wide; card content and role opt-ins are not.
    if ((prefs.hideDetails !== undefined || prefs.workerOptIn !== undefined || prefs.coverOptIn !== undefined) &&
        (!key || key !== expectedScope)) return;
    const previous = state.preferenceScope === key ? state.preferences : { ...defaults, statusCardsEnabled: state.preferences.statusCardsEnabled };
    const preferences = { ...previous, ...prefs };
    if (state.preferenceScope === key && preferences.statusCardsEnabled === previous.statusCardsEnabled &&
        preferences.hideDetails === previous.hideDetails && preferences.workerOptIn === previous.workerOptIn && preferences.coverOptIn === previous.coverOptIn) return;
    let card = state.active;
    if (card && (card.scopeKey !== key || !preferences.statusCardsEnabled || (prefs.workerOptIn === false && card.target.kind === "worker_shift") ||
        (prefs.coverOptIn === false && card.target.kind === "foreman_cover"))) {
      await bridge.stop(card.id);
      card = null;
    } else if (card && prefs.hideDetails === true && !previous.hideDetails) {
      // Redact before persisting the change, even when no fresh record has been read since boot.
      if (!await bridge.redact(card.id).catch(() => false)) {
        await bridge.stop(card.id);
        card = null;
      }
      if (applied) applied.fingerprint = "";
    }
    if (!card) { applied = null; armExpiry(null); }
    try { await persist({ preferences, preferenceScope: key, active: card }); }
    catch (error) {
      // A failed local write must not let later refreshes re-disclose details in this session.
      if (prefs.hideDetails === true) {
        if (card) await bridge.stop(card.id);
        applied = null; armExpiry(null);
        publish({ preferences, preferenceScope: key, active: null });
      }
      throw error;
    }
    if (card && applied && prefs.hideDetails === false) await applyRefresh(applied.source, applied.copy, card.scopeKey);
  });
}

async function allowAndroidCard(channelName: string) {
  if (Platform.OS !== "android") return true;
  const existing = await Notifications.getNotificationChannelAsync("bookbuddy-status-cards");
  if (!existing) await Notifications.setNotificationChannelAsync("bookbuddy-status-cards", {
    name: channelName, importance: Notifications.AndroidImportance.LOW, showBadge: false, enableVibrate: false, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  if (existing?.importance === Notifications.AndroidImportance.NONE) return false;
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted || (permission.canAskAgain && (await Notifications.requestPermissionsAsync()).granted);
}

function authorized(target: StatusCardTarget, expected: string | undefined) {
  if (!scope || scope.key !== expected || scope.expiresAt <= Date.now()) return false;
  return scope.role === (target.kind === "customer_visit" || target.kind === "session" ? "customer" : target.kind === "worker_shift" ? "worker" : "foreman");
}

export function startStatusCard(source: StatusCardSource, copy: CardCopy, expected: string | undefined) {
  return serialize(async () => {
    if (!bridge || AppState.currentState !== "active" || !authorized(source.target, expected)) return false;
    await hydrate();
    if (!authorized(source.target, expected) || state.preferenceScope !== expected) return false;
    if (state.active?.stopPending) return false;
    const prefs = state.preferences;
    if (!prefs.statusCardsEnabled || (source.target.kind === "foreman_cover" && !prefs.coverOptIn) || (source.target.kind === "worker_shift" && prefs.workerOptIn !== true)) return false;
    const now = Date.now();
    const expiresAt = cardExpiry(source, now, scope!.expiresAt);
    if (now >= expiresAt) return false;
    const deadline = source.facts?.kind === "foreman_cover" ? source.facts.deadline : null;
    if (deadline !== null && now >= deadline) return false;
    const card = nativeCard(source, copy, prefs.hideDetails, now, expiresAt);
    if (!card || !await allowAndroidCard(copy.t("mobile.statusCards.channel")) || !authorized(source.target, expected) || AppState.currentState !== "active") return false;
    if (Date.now() >= Math.min(deadline ?? expiresAt, expiresAt)) return false;
    if (state.active?.scopeKey === expected && state.active?.target.kind === source.target.kind && state.active.target.id === source.target.id && await bridge.clear(state.active.id)) return true;
    const active = { id: uuid.v4(), scopeKey: scope!.key, target: source.target, expiresAt };
    await bridge.clear(null);
    // Persist only identifiers and expiry; detailed content stays in the live OS surface.
    await persist({ ...state, active });
    const payload = JSON.stringify(card);
    try {
      if (!authorized(source.target, expected) || AppState.currentState !== "active" || !await bridge.start(active.id, payload)) {
        await persist({ ...state, active: null });
        return false;
      }
    } catch (error) {
      await bridge.stop(active.id);
      await persist({ ...state, active: null });
      throw error;
    }
    applied = { source, copy, fingerprint: payload };
    armExpiry(active);
    return true;
  });
}

async function applyRefresh(source: StatusCardSource, copy: CardCopy, expected: string | undefined) {
  const active = state.active;
  if (!bridge || !active || active.stopPending || active.scopeKey !== expected || active.target.kind !== source.target.kind ||
      active.target.id !== source.target.id || !authorized(source.target, expected)) return;
  const now = Date.now();
  const expiresAt = Math.min(active.expiresAt, cardExpiry(source, now, scope!.expiresAt));
  if (!source.terminal && now < expiresAt) {
    if (AppState.currentState !== "active") return;
    const card = nativeCard(source, copy, state.preferences.hideDetails, now, expiresAt);
    if (card) {
      const fingerprint = JSON.stringify(card);
      if (fingerprint === applied?.fingerprint || await bridge.update(active.id, fingerprint)) {
        applied = { source, copy, fingerprint };
        if (expiresAt < active.expiresAt) {
          const shortened = { ...active, expiresAt };
          armExpiry(shortened);
          await persist({ ...state, active: shortened });
        }
        return;
      }
      if (AppState.currentState !== "active") return;
    }
  }
  await finishStop(await stopJournal.mark(active));
}

export function refreshStatusCard(source: StatusCardSource, copy: CardCopy, expected: string | undefined) {
  return serialize(() => applyRefresh(source, copy, expected));
}

export function stopStatusCard(id: string, expected: string | undefined) {
  return serialize(async () => {
    const card = state.active;
    if (!bridge || !card || card.id !== id || card.scopeKey !== expected) return;
    await finishStop(await stopJournal.mark(card));
  });
}
