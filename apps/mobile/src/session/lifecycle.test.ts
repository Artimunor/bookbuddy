import { accountIdSchema, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { createRepositoryAccess } from "../repository/open-policy";
import { expireOfflineView, readUnlockedSession, sessionView, watchBackgroundLock } from "./lifecycle";
import { projectOfflineBootstrap } from "./offline-bootstrap";
import type { ActiveSession } from "./sign-out";

const accountId = accountIdSchema.parse("account");
const bootstrap = sessionBootstrapSchema.parse({
  sessionId: "session", expiresAt: 30 * 86_400_000, setup: "complete",
  account: { id: accountId, email: "person@example.test", displayName: "Worker" },
  activeContext: { contextId: "staff", role: "worker", businessId: "business", businessName: "Provider", membershipId: "member" },
  contexts: [],
  preferences: { uiLocale: "pt-PT", readingLocale: "en", displayZone: "Europe/Lisbon", revision: 1, theme: "dark", fieldMode: null, twoClock: true },
});
const cached = projectOfflineBootstrap(bootstrap, 1_000)!;
const record: ActiveSession = { state: "active", credential: "saved-bearer", proof: "saved-proof",
  session: { accountId, sessionId: bootstrap.sessionId, setup: bootstrap.setup, expiresAt: bootstrap.expiresAt, activeContext: cached.activeContext } };

test("a denied native prompt never releases a saved bearer, unlike an ineligible device", async () => {
  const calls: string[] = [];
  let eligible = true;
  let approved = false;
  const access = createRepositoryAccess({
    eligible: async () => eligible,
    existing: () => true,
    authenticate: async () => { calls.push("prompt"); return approved; },
    sweepEphemeral: () => { calls.push("sweep"); },
    persistent: async () => ({ getOfflineBootstrap: async () => { calls.push("read cached"); return cached; } }),
    memory: () => ({ getOfflineBootstrap: async () => { calls.push("memory"); return null; } }),
  });
  const restore = () => readUnlockedSession(record, () => access.open("Unlock"), () => 1_000);
  expect(await restore()).toBeNull();
  expect(calls).toEqual(["prompt"]);
  eligible = false;
  expect(await restore()).toEqual({ record, cached: null });
  expect(calls).toEqual(["prompt", "sweep", "memory"]);
  eligible = approved = true;
  expect(await restore()).toEqual({ record, cached });
  expect(calls).toEqual(["prompt", "sweep", "memory", "prompt", "read cached"]);
});

test("foregrounding after five suspended minutes invalidates the repository unlock", async () => {
  let now = 1_000;
  let prompts = 0;
  let approved = true;
  let eligible = true;
  const access = createRepositoryAccess({
    eligible: async () => eligible, existing: () => true,
    authenticate: async () => { prompts++; return approved; }, sweepEphemeral: () => {},
    persistent: async () => "persistent", memory: () => "memory",
  });
  const timer = watchBackgroundLock(access.lock, () => now);
  try {
    expect(await access.open("Unlock")).toBe("persistent");
    timer.background();
    now += 5 * 60_000 - 1;
    timer.foreground();
    expect(await access.open("Unlock")).toBe("persistent");
    expect(prompts).toBe(1);

    timer.background();
    now += 5 * 60_000;
    timer.foreground();
    eligible = false;
    expect(await access.open("Unlock", true)).toBeNull();
    eligible = true;
    approved = false;
    expect(await access.open("Unlock", true)).toBeNull();
    expect(prompts).toBe(2);
    approved = true;
    expect(await access.open("Unlock", true)).toBe("persistent");
    expect(prompts).toBe(3);
  } finally { timer.dispose(); }
});

test("offline bootstrap expiry drops the role, bootstrap and preferences of a confirmed session", () => {
  const live = sessionView(record.session, bootstrap, cached);
  expect(live.session?.activeContext?.role).toBe("worker");
  expect(live.preferences?.uiLocale).toBe("pt-PT");
  expect(expireOfflineView(live.session)).toEqual({
    session: { ...record.session, activeContext: null }, bootstrap: null, offlineBootstrap: null, preferences: null,
  });
});
