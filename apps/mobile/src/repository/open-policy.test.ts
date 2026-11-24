import { expect, test } from "bun:test";
import { createRepositoryAccess } from "./open-policy";

test("the first persistent open sweeps orphaned ephemeral files without sweeping again on store changes", async () => {
  const ephemeral = new Set(["capture-from-interrupted-memory-session"]);
  let sweeps = 0;
  let eligible = true;
  const access = createRepositoryAccess({
    eligible: async () => eligible, existing: () => true, authenticate: async () => true,
    sweepEphemeral: () => { sweeps++; ephemeral.clear(); },
    persistent: async () => "persistent", memory: () => "memory",
  });
  expect(await access.open("Unlock")).toBe("persistent");
  expect(ephemeral.size).toBe(0);

  access.lock();
  eligible = false;
  expect(await access.open("Unlock")).toBe("memory");
  ephemeral.add("current-memory-capture");
  eligible = true;
  expect(await access.open("Unlock")).toBe("persistent");
  expect([...ephemeral]).toEqual(["current-memory-capture"]);
  expect(sweeps).toBe(1);
});
