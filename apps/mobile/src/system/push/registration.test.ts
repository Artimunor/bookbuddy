import { createApiClient } from "@bookbuddy/api-client";
import { expect, mock, test } from "bun:test";

const token = "ExpoPushToken[same-device]";
let tokenReads = 0;
mock.module("expo", () => ({ uuid: { v4: () => crypto.randomUUID() } }));
mock.module("expo-constants", () => ({ default: { expoConfig: { extra: { eas: { projectId: "test-project" } } } } }));
mock.module("expo-notifications", () => ({
  requestPermissionsAsync: async () => ({ granted: true }),
  getExpoPushTokenAsync: async () => { tokenReads++; return { data: token }; },
}));
mock.module("react-native", () => ({ Platform: { OS: "ios" } }));

// Install the native module doubles before the registration module loads.
const { defaultPushSettings, enablePush, pushEnabledForSession, refreshPush, savePushSettings } = await import("./index");

const oldOwner = { accountId: "account", sessionId: "session-a" };
const newOwner = { ...oldOwner, sessionId: "session-b" };
const installationId = "installation";

function transport() {
  const requests: { operationId: string; expectedRevision: number; payload: { token: string; platform: string } }[] = [];
  const client = createApiClient({
    baseUrl: "https://app.example.test/api/v1",
    getSession: () => "session-b-bearer",
    getLocale: () => "en",
    fetch: async (url, init) => {
      expect(url).toBe(`https://app.example.test/api/v1/push/installations/${installationId}`);
      expect(init.method).toBe("PUT");
      expect(new Headers(init.headers).get("authorization")).toBe("Bearer session-b-bearer");
      const request = JSON.parse(init.body as string);
      requests.push(request);
      return Response.json({ ok: true, data: { id: installationId, tokenEpoch: request.expectedRevision + 1,
        state: "active", status: request.operationId === "pending-a" ? "replayed" : "committed" },
        meta: { requestId: "req-1", serverTime: 1_000 } });
    },
  });
  return { client, requests };
}

test("a new session must opt in once even when the account and push token match", async () => {
  const previous = { ...defaultPushSettings, ...oldOwner, active: true, notifications: true, installationId, epoch: 3, token };
  await savePushSettings(previous);
  const { client, requests } = transport();
  expect(pushEnabledForSession(previous, newOwner)).toBe(false);

  const priorTokenReads = tokenReads;
  await refreshPush(client, newOwner, { type: "ios", data: "same-device" });
  expect(tokenReads).toBe(priorTokenReads);
  expect(requests).toEqual([]);

  const enabled = await enablePush(client, newOwner);
  expect(enabled).toMatchObject({ ...newOwner, installationId, epoch: 4, token, active: true });
  expect(pushEnabledForSession(enabled, newOwner)).toBe(true);
  await enablePush(client, newOwner);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ expectedRevision: 3, payload: { token, platform: "ios" } });
});

test("replaying the previous session's pending PUT does not count as opting in the new session", async () => {
  await savePushSettings({ ...defaultPushSettings, ...oldOwner, installationId, epoch: 3, pending: {
    ...oldOwner, installationId, kind: "put", operationId: "pending-a", expectedRevision: 3, prefsHash: "active", token, platform: "ios",
  } });
  const { client, requests } = transport();
  expect(await enablePush(client, newOwner)).toMatchObject({ ...newOwner, epoch: 5 });
  expect(requests.map(({ expectedRevision }) => expectedRevision)).toEqual([3, 4]);
  expect(requests[0]?.operationId).toBe("pending-a");
  expect(requests[1]?.operationId).not.toBe("pending-a");
});
