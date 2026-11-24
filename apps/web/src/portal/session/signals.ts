import { idSchema } from "@bookbuddy/api-contract";
import type { PortalIdentity } from "./api";

const topic = "bookbuddy.portal-session.v1";
export type SessionSignal = ({ kind: "changed" } & PortalIdentity) | { kind: "signed_out"; sessionId: string };
export type SessionSignals = { publish: (signal: SessionSignal) => void; close: () => void };

export function connectSessionSignals(receive: (signal: SessionSignal) => void): SessionSignals {
  let channel: BroadcastChannel | undefined;
  try { if (typeof BroadcastChannel !== "undefined") channel = new BroadcastChannel(topic); }
  catch { /* Storage remains available when the channel is denied. */ }
  const seen = new Set<string>();
  function deliver(message: unknown) {
    if (!message || typeof message !== "object" || !("nonce" in message) || !("sessionId" in message) || !("kind" in message)) return;
    const { nonce, sessionId, kind } = message;
    if (typeof nonce !== "string" || typeof sessionId !== "string" || !idSchema.safeParse(nonce).success ||
      !idSchema.safeParse(sessionId).success || seen.has(nonce)) return;
    let signal: SessionSignal;
    if (kind === "signed_out") signal = { kind, sessionId };
    else if (kind === "changed" && "contextId" in message && (message.contextId === null ||
      typeof message.contextId === "string" && idSchema.safeParse(message.contextId).success)) {
      signal = { kind, sessionId, contextId: message.contextId };
    } else return;
    seen.add(nonce);
    if (seen.size > 32) seen.delete(seen.values().next().value!);
    receive(signal);
  }
  function storage(event: StorageEvent) {
    if (event.key !== topic || event.newValue === null) return;
    try { deliver(JSON.parse(event.newValue)); } catch { /* Ignore corrupt signals. */ }
  }
  if (channel) channel.onmessage = event => deliver(event.data);
  window.addEventListener("storage", storage);
  return {
    publish(signal) {
      const event = { ...signal, nonce: crypto.randomUUID() };
      try { channel?.postMessage(event); } catch { /* Try storage even if the channel closed. */ }
      try {
        localStorage.setItem(topic, JSON.stringify(event));
        localStorage.removeItem(topic);
      } catch { /* Storage may be disabled. */ }
    },
    close() { window.removeEventListener("storage", storage); channel?.close(); },
  };
}
