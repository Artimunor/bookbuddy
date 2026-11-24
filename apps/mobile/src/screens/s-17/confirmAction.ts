import type { MessageKey, MessageValues } from "@bookbuddy/i18n";
import type { Href } from "expo-router";
import type { ComponentRef, RefObject } from "react";
import type { View } from "react-native";

/** Copy keys with no ICU arguments; caller formats record-specific text separately. */
export type PlainMobileKey = { [K in MessageKey<"mobile">]: MessageValues<K> extends undefined ? K : never }[MessageKey<"mobile">];
export type ConfirmResult = "confirmed" | "invalidated" | "uncertain";
export type ConfirmRequest = {
  /** Labels are translated at the caller, with literal catalog keys. */
  title: string;
  actionLabel: string;
  actionLabelKey: PlainMobileKey;
  item: string;
  actor: string;
  role: string;
  effects: readonly string[];
  /** Recheck authorization and the reviewed version in the command itself. */
  onConfirm: () => Promise<ConfirmResult>;
  onReview: () => void;
  /** Local actions such as sign-out can proceed without a connection. */
  serverAction?: boolean;
  offline?: boolean;
  destructive?: boolean;
  returnFocusRef?: RefObject<ComponentRef<typeof View> | null>;
};

const requests = new Map<string, ConfirmRequest>();
let sequence = 0;

/** Opens a confirmation without executing the action. The callback stays in memory, never in a URL. */
export function confirmAction(router: { push: (href: Href) => void }, request: ConfirmRequest): void {
  const id = String(++sequence);
  requests.set(id, request);
  try { router.push({ pathname: "/confirm", params: { id } } as Href); }
  catch (error) { requests.delete(id); throw error; }
}

export function confirmationRequest(id: string | undefined) { return id ? requests.get(id) : undefined; }
export function forgetConfirmation(id: string | undefined) { if (id) requests.delete(id); }
