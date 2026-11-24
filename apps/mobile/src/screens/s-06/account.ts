import { sessionRoute, type ActiveContext } from "@bookbuddy/api-contract";
import type { Translator } from "@bookbuddy/i18n";
import { useEffect, useState } from "react";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useSession } from "../../session";

export type RoleChoice = ActiveContext & { businessName?: string | null };
export type Role = RoleChoice["role"];
export const roleRoots = { customer: "/c/now", foreman: "/f/now", worker: "/w/now", provider_admin: "/p/now" } as const;

export function useAccountDetails(enabled = true) {
  const { session, bootstrap, acceptBootstrap } = useSession();
  const { connection: { offline }, client } = useApiAccess();
  const remote = useRemote(sessionRoute, {}, { enabled: enabled && !!session && !bootstrap && !offline });
  const data = remote.data?.sessionId === session?.sessionId && remote.data?.account.id === session?.accountId ? remote.data : null;
  const [applyFailed, setApplyFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!data) return;
    let live = true;
    void acceptBootstrap(data).catch(() => { if (live) setApplyFailed(true); });
    return () => { live = false; };
  }, [data, acceptBootstrap, attempt]);
  return {
    session, bootstrap, offline,
    loading: enabled && !!session && !bootstrap && !offline && !!client && !applyFailed && remote.status !== "error",
    canRetry: enabled && !offline && !!client && (applyFailed || remote.status === "error"),
    retry: () => {
      if (data) { setApplyFailed(false); setAttempt((n) => n + 1); }
      else void remote.refresh();
    },
  };
}

type Translate = Translator<"mobile">["t"];

export function roleLabel(t: Translate, role: Role) {
  switch (role) {
    case "customer": return t("mobile.you.customer");
    case "foreman": return t("mobile.you.foreman");
    case "worker": return t("mobile.you.worker");
    case "provider_admin": return t("mobile.you.admin");
  }
}

export function isolated(value: string) { return `\u2068${value}\u2069`; }

export function businessLabel(t: Translate, choice: RoleChoice, choices: readonly RoleChoice[]) {
  if (choice.businessName) return isolated(choice.businessName);
  if (!choice.businessId) return undefined;
  const ids = [...new Set(choices.flatMap(({ businessId }) => businessId ? [businessId] : []))];
  return t("mobile.you.business", { number: Math.max(1, ids.indexOf(choice.businessId) + 1) });
}

export function initials(name: string) {
  return name.trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0] ?? "").join("").toLocaleUpperCase();
}
