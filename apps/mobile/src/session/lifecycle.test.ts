import { createApiClient } from "@bookbuddy/api-client";
import { accountIdSchema, sessionBootstrapSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { createRepositoryAccess } from "../repository/open-policy";
import { expireOfflineView, readUnlockedSession, sessionView, watchBackgroundLock } from "./lifecycle";
import { projectOfflineBootstrap } from "./offline-bootstrap";
import { parseStoredSession, sendRevocation, settleSignOut } from "./sign-out";
import type { ActiveSession, EndingSession, Revocation } from "./sign-out";

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

test("enrollment loss replaces the bearer with a proof kept until the server acknowledges revocation", async () => {
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
  const restored = await readUnlockedSession(stored, requiresUnlock => access.open("Unlock", requiresUnlock), () => 1_000);
  if (!restored || !("ending" in restored)) throw new Error("Expected revocation without an unlocked session");
  const storage = {
    save: async (intent: EndingSession) => { raw = JSON.stringify(intent); },
    remove: async () => { raw = null; },
    finalizeLocal: async () => { calls.push("cleanup"); },
  };
  // An offline restore must durably replace the bearer without opening the cache.
  expect(await settleSignOut(restored.ending, storage)).toBe(false);
  expect(raw).not.toContain("credential");
  const marker = raw;
  const pending = parseStoredSession(marker ?? "", false);
  const proof = { sessionId: record.session.sessionId, proof: record.proof };
  expect(pending).toMatchObject({ state: "ending", localPending: false, revocation: { mode: "native", ...proof } });
  if (pending.state !== "ending") throw new Error("Expected revocation marker");

  let sent = 0;
  const api = createApiClient({
    baseUrl: "https://app.example.test/api/v1",
    getSession: () => record.credential,
    getLocale: () => "en",
    fetch: async (url, init) => {
      expect(url).toBe("https://app.example.test/api/v1/session/revoke");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("authorization")).toBeNull();
      expect(JSON.parse(init.body as string)).toEqual(proof);
      expect(raw).toBe(marker);
      if (++sent === 1) throw new Error("Lost response");
      return Response.json({ ok: true, data: { ended: true }, meta: { requestId: "req-1", serverTime: 1_000 } });
    },
  });
  const progress = { intent: pending, persisted: true };
  const remote = { ...storage, revoke: (revocation: Revocation) => sendRevocation(api, revocation) };
  expect(await settleSignOut(progress, remote)).toBe(false);
  expect(raw).toBe(marker);
  expect(await settleSignOut(progress, remote)).toBe(true);
  expect(raw).toBeNull();
  expect(sent).toBe(2);
  expect(calls).toEqual(["eligibility"]);
});

test("a legacy session still requires a prompt with no database, and denial keeps the bearer locked", async () => {
  const { requiresUnlock: _, ...legacy } = record;
  const stored = parseStoredSession(JSON.stringify(legacy), false);
  expect(stored).toEqual(record);
  if (stored.state !== "active") throw new Error("Expected an active session");
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
  const open = (requiresUnlock: boolean) => access.open("Unlock", requiresUnlock);
  expect(await readUnlockedSession(stored, open, () => 1_000)).toBeNull();
  expect(calls).toEqual(["prompt"]);
  approved = true;
  expect(await readUnlockedSession(stored, open, () => 1_000)).toEqual({ record, cached: null });
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
