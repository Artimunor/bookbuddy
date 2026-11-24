import { expect, mock, test } from "bun:test";
import { createLiveSubscription } from "../src";

function socketStub() {
  const events: Pick<WebSocket, "onmessage" | "onclose" | "onerror" | "close"> = {
    onmessage: null, onclose: null, onerror: null, close: mock(() => {}),
  };
  return events as WebSocket;
}

const topic = { kind: "customer-visit", opaqueId: "visit-afternoon" } as const;

test.each(["error then close", "close only"])("a reconnect denied before ready reports unavailability once (%s)", async (failure) => {
  const first = socketStub();
  const denied = socketStub();
  let socket = first;
  const onUnavailable = mock(() => {});
  const onHint = mock(() => {});
  const subscription = createLiveSubscription(topic, async () => socket, () => true, () => ({ onHint, onUnavailable }));
  expect(subscription.connect()).toBe(true);
  await Promise.resolve();
  first.onmessage?.call(first, new MessageEvent("message", { data: JSON.stringify({ kind: "ready" }) }));
  subscription.disconnect();

  socket = denied;
  expect(subscription.connect()).toBe(true);
  await Promise.resolve();
  const close = denied.onclose;
  expect(close).not.toBeNull();
  if (failure === "error then close") {
    denied.onerror?.call(denied, new Event("error"));
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(denied.close).toHaveBeenCalledTimes(1);
  }
  close?.call(denied, { code: 1006 } as CloseEvent);
  expect(onUnavailable).toHaveBeenCalledTimes(1);
  expect(onHint).not.toHaveBeenCalled();
});

test("a scope closure after ready still invokes the immediate reauthorization callback", async () => {
  const socket = socketStub();
  const onUnavailable = mock(() => {});
  const onScopeClosed = mock(() => {});
  const subscription = createLiveSubscription(topic, async () => socket, () => true,
    () => ({ onHint: () => {}, onUnavailable, onScopeClosed }));
  expect(subscription.connect()).toBe(true);
  await Promise.resolve();
  socket.onmessage?.call(socket, new MessageEvent("message", { data: JSON.stringify({ kind: "ready" }) }));
  socket.onerror?.call(socket, new Event("error"));
  socket.onclose?.call(socket, { code: 1008 } as CloseEvent);
  expect(onScopeClosed).toHaveBeenCalledTimes(1);
  expect(onUnavailable).not.toHaveBeenCalled();
});
