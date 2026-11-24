import type { ApiClient } from "@bookbuddy/api-client";
import { deletePushInstallationRoute, opaqueLinkUrlSchema, putPushInstallationRoute } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { loadPushSettings, savePushSettings, type PushIntent, type PushSettings } from "./settings";

export { defaultPushSettings, loadPushSettings, savePushSettings, type PushSettings } from "./settings";

let tail: Promise<void> = Promise.resolve();
const signedOut = new Set<string>();
let inFlight: AbortController | undefined;
function serialize<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work);
  tail = result.then(() => undefined, () => undefined);
  return result;
}

// Replay the exact saved intent on an uncertain outcome; never mint a second operation.
async function resolvePending(client: ApiClient, accountId: string, signal?: AbortSignal): Promise<PushSettings> {
  const settings = await loadPushSettings();
  const intent = settings.pending;
  if (signedOut.has(accountId)) throw new Error("Push registration belongs to a signed-out account");
  if (!intent) return settings;
  if (intent.accountId !== accountId) throw new Error("Another account has an unresolved push registration");
  if (signal?.aborted) throw new Error("Push request cancelled");
  const body = { operationId: intent.operationId as never, expectedRevision: intent.expectedRevision };
  const result = intent.kind === "put"
    ? await client.request(putPushInstallationRoute, { params: { id: intent.installationId }, body: { ...body, payload: { token: intent.token, platform: intent.platform } } }, { signal })
    : await client.request(deletePushInstallationRoute, { params: { id: intent.installationId }, body: { ...body, payload: {} } }, { signal });
  if (!result.ok) {
    const error = result.error;
    const uncertain = ("delivery" in error && error.delivery === "unknown") || error.code === "INTERNAL_ERROR" || error.code === "UNAVAILABLE";
    if (!uncertain) { const { pending: _, ...rest } = settings; await savePushSettings(rest); }
    throw new Error(uncertain ? "Push registration is being checked" : "Push registration was not confirmed");
  }
  const { pending: _, ...rest } = settings;
  const active = intent.kind === "put" && !signedOut.has(accountId) && !settings.requiresReregister;
  const next: PushSettings = { ...rest, accountId, installationId: intent.installationId, epoch: result.data.tokenEpoch,
    active, notifications: active, ...(intent.kind === "put" ? { token: intent.token } : {}) };
  await savePushSettings(next);
  return next;
}

async function registerToken(client: ApiClient, accountId: string, token: string, signal: AbortSignal): Promise<PushSettings> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("Push is unavailable on this platform");
  const previous = await resolvePending(client, accountId, signal);
  const sameAccount = previous.accountId === accountId;
  if (sameAccount && previous.active && previous.token === token) return previous;
  const intent: PushIntent = { kind: "put", accountId, installationId: sameAccount && previous.installationId ? previous.installationId : uuid.v4(),
    operationId: uuid.v4(), expectedRevision: sameAccount ? previous.epoch : 0, prefsHash: "active", token, platform: Platform.OS };
  await savePushSettings({ ...previous, requiresReregister: false, pending: intent });
  return resolvePending(client, accountId, signal);
}

// This is called only on deliberate opt-in; boot never asks for permission or a token.
export async function enablePush(client: ApiClient, accountId: string): Promise<PushSettings> {
  signedOut.delete(accountId);
  if (Platform.OS !== "ios" && Platform.OS !== "android") throw new Error("Push is unavailable on this platform");
  const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof projectId !== "string" || !projectId) throw new Error("Push project is not configured");
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission not granted");
  if (signedOut.has(accountId)) throw new Error("Push registration belongs to a signed-out account");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return serialize(async () => {
    const controller = new AbortController(); inFlight = controller;
    try { return await registerToken(client, accountId, token, controller.signal); }
    finally { if (inFlight === controller) inFlight = undefined; }
  });
}

export async function refreshPush(client: ApiClient, accountId: string, devicePushToken: Notifications.DevicePushToken): Promise<void> {
  const previous = await loadPushSettings();
  const projectId: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  if (!previous.active || !previous.notifications || previous.accountId !== accountId || signedOut.has(accountId) || typeof projectId !== "string" || !projectId) return;
  const token = (await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken })).data;
  await serialize(async () => {
    const controller = new AbortController(); inFlight = controller;
    try { await registerToken(client, accountId, token, controller.signal); }
    finally { if (inFlight === controller) inFlight = undefined; }
  });
}

export function lockPushForSignedOutAccount(accountId: string) {
  signedOut.add(accountId);
  inFlight?.abort();
}

export function disablePushForSignedOutAccount(accountId: string): Promise<void> {
  lockPushForSignedOutAccount(accountId);
  return serialize(async () => {
    const settings = await loadPushSettings();
    if (settings.accountId === accountId || settings.pending?.accountId === accountId) {
      const { pending, ...rest } = settings;
      await savePushSettings({ ...rest, notifications: false, active: false, requiresReregister: true, token: undefined,
        ...(pending?.accountId === accountId ? { installationId: undefined, epoch: 0 } : {}) });
    }
  });
}

export function revokePush(client: ApiClient | null, accountId: string, signal?: AbortSignal): Promise<void> {
  return serialize(async () => {
    let previous = await loadPushSettings();
    if (previous.pending) {
      if (!client) throw new Error("Push revocation unavailable");
      previous = await resolvePending(client, accountId, signal);
    }
    if (!previous.active || previous.accountId !== accountId || !previous.installationId) return;
    if (!client || signal?.aborted) throw new Error("Push revocation unavailable");
    const intent: PushIntent = { kind: "delete", accountId, installationId: previous.installationId, operationId: uuid.v4(),
      expectedRevision: previous.epoch, prefsHash: "inactive" };
    await savePushSettings({ ...previous, pending: intent });
    await resolvePending(client, accountId, signal);
  });
}

export function pushPath(data: unknown): `/l/${string}` | null {
  if (!data || typeof data !== "object" || !("url" in data) || typeof data.url !== "string") return null;
  const parsed = opaqueLinkUrlSchema.safeParse(data.url);
  if (!parsed.success) return null;
  const host = Constants.expoConfig?.ios?.associatedDomains?.find((domain) => domain.startsWith("applinks:"))?.slice("applinks:".length)
    ?? Constants.expoConfig?.android?.intentFilters?.flatMap((filter) => filter.data ?? []).find((item) => item.host)?.host;
  const url = new URL(parsed.data);
  if (!host || url.host !== host) return null;
  return url.pathname as `/l/${string}`;
}
