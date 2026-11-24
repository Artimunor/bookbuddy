import { localPreferenceStorage } from "../../i18n/storage";

const key = "bookbuddy-push-settings";
export type PushIntent = { accountId: string; installationId: string; operationId: string; expectedRevision: number; prefsHash: string } & (
  | { kind: "put"; sessionId: string; token: string; platform: "ios" | "android" }
  | { kind: "delete" }
);
export type PushSettings = { notifications: boolean; liveSurface: boolean; hideDetails: boolean; installationId?: string; accountId?: string; sessionId?: string; token?: string; epoch: number; active: boolean; requiresReregister?: boolean; pending?: PushIntent };
export const defaultPushSettings: PushSettings = { notifications: false, liveSurface: false, hideDetails: true, epoch: 0, active: false };
let cached: PushSettings | undefined;
let loading: Promise<PushSettings> | undefined;
export function loadPushSettings(): Promise<PushSettings> {
  if (cached) return Promise.resolve(cached);
  return loading ??= localPreferenceStorage.read(key).then((raw) => {
    try { cached = raw ? { ...defaultPushSettings, ...JSON.parse(raw) } : { ...defaultPushSettings }; }
    catch { cached = { ...defaultPushSettings }; }
    return cached!;
  }).finally(() => { loading = undefined; });
}
export async function savePushSettings(next: PushSettings): Promise<void> {
  await localPreferenceStorage.write(key, JSON.stringify(next));
  cached = next;
}
export function currentPushSettings() { return cached; }
