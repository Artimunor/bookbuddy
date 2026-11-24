import { accountIdSchema, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { createRepositoryAccess } from "../repository/open-policy";
import { expireOfflineView, readUnlockedSession, sessionView, watchBackgroundLock } from "./lifecycle";
import { projectOfflineBootstrap } from "./offline-bootstrap";
import { parseStoredSession } from "./sign-out";
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
const record: ActiveSession = { state: "active", requiresUnlock: true, credential: "A".repeat(43), proof: `r1.${"Q".repeat(42)}A`,
  session: { accountId, sessionId: bootstrap.sessionId, setup: bootstrap.setup, expiresAt: bootstrap.expiresAt, activeContext: cached.activeContext } };

test("cold restore discards the saved bearer when device enrollment is lost", async () => {
  const calls: string[] = [];
  let raw: string | null = JSON.stringify(record);
  const stored = parseStoredSession(raw, false);
  if (stored.state !== "active") throw new Error("Expected an active session");
  const access = createRepositoryAccess({
    eligible: async () => { calls.push("eligibility"); return false; },
    existing: () => true,
    authenticate: async () => { calls.push("prompt"); return false; },
    sweepEphemeral: () => { calls.push("sweep"); },
    persistent: async () => ({ getOfflineBootstrap: async () => { calls.push("read cached"); return cached; } }),
    memory: () => ({ getOfflineBootstrap: async () => { calls.push("memory"); return null; } }),
  });
  const restored = await readUnlockedSession(stored, requiresUnlock => access.open("Unlock", requiresUnlock),
    async () => { calls.push("discard"); raw = null; }, () => 1_000);
  expect(restored).toBeNull(); // The provider has no record from which to rebind.
  expect(raw).toBeNull();
  expect(calls).toEqual(["eligibility", "discard"]);
});

test("a protected restore prompts even with no database, and denial keeps the bearer locked", async () => {
  const calls: string[] = [];
  let approved = false;
  const access = createRepositoryAccess({
    eligible: async () => true,
    existing: () => false,
    authenticate: async () => { calls.push("prompt"); return approved; },
    sweepEphemeral: () => { calls.push("sweep"); },
    persistent: async () => ({ getOfflineBootstrap: async () => { calls.push("read cached"); return null; } }),
    memory: () => ({ getOfflineBootstrap: async () => { calls.push("memory"); return null; } }),
  });
  const restore = () => readUnlockedSession(record, requiresUnlock => access.open("Unlock", requiresUnlock),
    async () => { calls.push("discard"); }, () => 1_000);
  expect(await restore()).toBeNull();
  expect(calls).toEqual(["prompt"]);
  approved = true;
  expect(await restore()).toEqual({ record, cached: null });
  expect(calls).toEqual(["prompt", "prompt", "sweep", "read cached"]);
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
    expect(await access.open("Unlock")).toEqual({ status: "open", repository: "persistent" });
    timer.background();
    now += 5 * 60_000 - 1;
    timer.foreground();
    expect(await access.open("Unlock")).toEqual({ status: "open", repository: "persistent" });
    expect(prompts).toBe(1);

    timer.background();
    now += 5 * 60_000;
    timer.foreground();
    eligible = false;
    expect(await access.open("Unlock", true)).toEqual({ status: "unavailable" });
    eligible = true;
    approved = false;
    expect(await access.open("Unlock", true)).toEqual({ status: "denied" });
    expect(prompts).toBe(2);
    approved = true;
    expect(await access.open("Unlock", true)).toEqual({ status: "open", repository: "persistent" });
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
