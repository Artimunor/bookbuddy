import { createAuthClient } from "@bookbuddy/api-client";
import { emailStartRoute, type EmailAttempt, type RouteRequest, type SessionBootstrap } from "@bookbuddy/api-contract";
import { formatSiteDateTime } from "@bookbuddy/domain";
import { uuid } from "expo";
import { useNetworkState } from "expo-network";
import { type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";
import { useApiClient } from "../../api";
import { localPreferenceStorage } from "../../i18n/storage";

export type EmailDevice = Omit<RouteRequest<typeof emailStartRoute.input>["body"], "attemptId">;
type Challenge = { device: EmailDevice; attempt: EmailAttempt; offset: number };
let challenge: Challenge | null = null;
let opaqueLink: string | null = null;
let emailDraft = "";

export const authFlow = {
  get challenge() { return challenge; },
  get email() { return emailDraft; },
  set email(email: string) { emailDraft = email; },
  get hasLink() { return opaqueLink !== null; },
  keepLink(opaque: string) {
    if (/^[A-Za-z0-9_-]{1,256}$/.test(opaque)) opaqueLink = opaque;
  },
  verify(device: EmailDevice, attempt: EmailAttempt, serverTime: number) {
    challenge = { device, attempt, offset: serverTime - Date.now() };
  },
  leaveChallenge() { challenge = null; },
};

const roots = { customer: "/c/now", foreman: "/f/now", worker: "/w/now", provider_admin: "/p/now" } as const;

export function afterAuthentication(router: { replace: (href: Href) => void }, session: SessionBootstrap) {
  challenge = null;
  emailDraft = "";
  if (session.setup === "required") {
    router.replace("/setup");
    return;
  }
  const opaque = opaqueLink;
  opaqueLink = null;
  if (opaque) router.replace({ pathname: "/l/[opaque]", params: { opaque } });
  else router.replace((session.activeContext ? roots[session.activeContext.role] : "/help") as Href);
}

export function openAuthHelp(router: { push: (href: Href) => void }) { router.push("/help" as Href); }

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Expo random UUIDs are backed by the OS CSPRNG. Exclude their fixed version and variant bits.
export function newAttemptId(): string {
  const hex = [uuid.v4(), uuid.v4(), uuid.v4()].map((id) => id.replaceAll("-", ""))
    .map((id) => id.slice(0, 12) + id.slice(13, 16) + id.slice(17)).join("").slice(0, 64);
  let output = "";
  let bits = 0;
  let length = 0;
  for (const digit of hex) {
    bits = (bits << 4) | Number.parseInt(digit, 16);
    length += 4;
    if (length >= 6) { length -= 6; output += alphabet[(bits >>> length) & 63]; }
  }
  return length ? output + alphabet[(bits << (6 - length)) & 63] : output;
}

let device: Promise<string> | undefined;
async function loadDeviceId() {
  const key = "bookbuddy.otp-device-id.v1";
  const stored = await localPreferenceStorage.read(key);
  if (stored && /^[a-z0-9-]{36}$/i.test(stored)) return stored;
  const id = uuid.v4();
  await localPreferenceStorage.write(key, id);
  return id;
}

export async function emailDevice(email: string): Promise<EmailDevice> {
  device ??= loadDeviceId().catch((error: unknown) => { device = undefined; throw error; });
  return { email, deviceId: await device, transport: Platform.OS === "web" ? "web" : "native" };
}

export function useAuthClient() {
  const api = useApiClient();
  return useMemo(() => api ? createAuthClient(api) : null, [api]);
}

export function useOffline(): boolean {
  const { isConnected, isInternetReachable } = useNetworkState();
  return isConnected === false || isInternetReachable === false;
}

// A deadline can wake the view once, or provide a local, never-polled countdown.
export function useDeadline(deadline: number, offset = 0, tick = false): number {
  const [, update] = useState(0);
  useEffect(() => {
    if (deadline === 0) return;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      clearTimeout(timer);
      const left = deadline - Date.now() - offset;
      if (left > 0) timer = setTimeout(refresh, Math.min(left, tick ? ((left - 1) % 1000) + 1 : 2 ** 31 - 1));
    };
    const refresh = () => { update((n) => n + 1); next(); };
    next();
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [deadline, offset, tick]);
  return Math.max(0, deadline - Date.now() - offset);
}

export function viewerTime(locale: string, at: number, zone?: string): string {
  const clock = formatSiteDateTime(at, zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, locale);
  return clock.kind === "available" ? clock.site.time : "";
}
