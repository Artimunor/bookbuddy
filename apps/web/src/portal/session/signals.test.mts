import { expect, test } from "bun:test";
import { connectSessionSignals, type SessionSignal } from "./signals";

test("sign-out sends through both transports without retaining a storage value or delivering twice", () => {
  const names = ["BroadcastChannel", "window", "localStorage"] as const;
  const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const events = new EventTarget();
  let broadcast: unknown;
  let persisted: string | null = null;
  let closed = false;
  const channels: Channel[] = [];
  class Channel {
    onmessage?: (event: { data: unknown }) => void;
    constructor() { channels.push(this); }
    postMessage(data: unknown) { broadcast = data; for (const channel of channels) if (channel !== this) channel.onmessage?.({ data }); }
    close() { closed = true; }
  }
  Object.defineProperties(globalThis, {
    BroadcastChannel: { configurable: true, value: Channel },
    window: { configurable: true, value: events },
    localStorage: { configurable: true, value: {
      setItem: (key: string, value: string) => {
        persisted = value;
        events.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
      },
      removeItem: () => { persisted = null; },
    } },
  });
  const received: SessionSignal[] = [];
  const receiver = connectSessionSignals(signal => received.push(signal));
  const sender = connectSessionSignals(() => {});
  try {
    const signOut = { kind: "signed_out", sessionId: "signed-out-id" } as const;
    sender.publish(signOut);
    expect(broadcast).toMatchObject(signOut);
    expect(received).toEqual([signOut]);
    expect(persisted).toBeNull();
  } finally {
    receiver.close(); sender.close();
    names.forEach((name, index) => {
      const original = originals[index];
      if (original) Object.defineProperty(globalThis, name, original);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
  expect(closed).toBe(true);
});
