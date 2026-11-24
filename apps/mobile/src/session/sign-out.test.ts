import { accountIdSchema } from "@bookbuddy/api-contract";
import { expect, test } from "bun:test";
import { beginSignOut, parseStoredSession, settleSignOut } from "./sign-out";
import type { ActiveSession, EndingSession } from "./sign-out";

const active: ActiveSession = { state: "active", requiresUnlock: true, credential: "A".repeat(43), proof: `r1.${"Q".repeat(42)}A`,
  session: { sessionId: "session", accountId: accountIdSchema.parse("account"), expiresAt: 10, setup: "complete", activeContext: null } };

test("offline sign-out replaces the bearer, seals once and retries until a server acknowledgement", async () => {
  const progress = beginSignOut(active, { disposition: "keep", persistent: true });
  let raw = JSON.stringify(active);
  let local = 0, calls = 0;
  const save = async (intent: EndingSession) => { raw = JSON.stringify(intent); };
  const remove = async () => { raw = ""; };
  const finalizeLocal = async (intent: EndingSession) => {
    expect(intent.disposition).toBe("keep");
    expect(raw).not.toContain(active.credential!);
    local++;
  };
  expect(await settleSignOut(progress, { save, remove, finalizeLocal })).toBe(false);
  expect(local).toBe(1);
  expect(raw).not.toContain("credential");
  const stored = parseStoredSession(raw, false);
  expect(stored.state).toBe("ending");
  if (stored.state !== "ending") throw new Error("Expected sign-out marker");
  const afterRestart = { intent: stored, persisted: true };
  const revoke = async (intent: NonNullable<EndingSession["revocation"]>) => {
    expect(intent).toEqual({ mode: "native", sessionId: "session", proof: active.proof });
    return ++calls === 2;
  };
  expect(await settleSignOut(afterRestart, { save, remove, finalizeLocal, revoke })).toBe(false);
  expect(await settleSignOut(afterRestart, { save, remove, finalizeLocal, revoke })).toBe(true);
  expect([raw, local, calls]).toEqual(["", 1, 2]);
});

test("a failed marker write cannot discard work or send a revocation in its place", async () => {
  const progress = beginSignOut(active, { disposition: "discard", persistent: true });
  let touched = false;
  await expect(settleSignOut(progress, {
    save: async () => { throw new Error("No SecureStore write"); }, remove: async () => { touched = true; },
    finalizeLocal: async () => { touched = true; }, revoke: async () => { touched = true; return true; },
  })).rejects.toThrow("No SecureStore write");
  expect(touched).toBe(false);
  expect(progress.persisted).toBe(false);
});

test("a failed discard cannot prevent remote revocation or erase the unfinished local marker", async () => {
  const progress = beginSignOut(active, { disposition: "discard", persistent: true });
  let remote = 0;
  const save = async (_intent: EndingSession) => {};
  const remove = async () => {};
  const revoke = async () => { remote++; return true; };
  await expect(settleSignOut(progress, { save, remove, revoke, finalizeLocal: async () => { throw new Error("staging failed"); } }))
    .rejects.toThrow("Local sign-out cleanup");
  expect(progress.intent).toMatchObject({ disposition: "discard", localPending: true, revocation: null });
  expect(await settleSignOut(progress, { save, remove, revoke, finalizeLocal: async () => {} })).toBe(true);
  expect(remote).toBe(1);
});
