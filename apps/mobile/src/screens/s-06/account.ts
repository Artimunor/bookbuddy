import type { Translator } from "@bookbuddy/i18n";
import { useApiAccess } from "../../api/provider";
import { useSession } from "../../session";
import type { SessionContextSummary } from "../../session/offline-bootstrap";

export type RoleChoice = Omit<SessionContextSummary, "businessName"> & { businessName?: string | null };
export type Role = RoleChoice["role"];
export const roleRoots = { customer: "/c/now", foreman: "/f/now", worker: "/w/now", provider_admin: "/p/now" } as const;

export function useAccountDetails(enabled = true) {
  const { session, bootstrap, offlineBootstrap, status, refreshSession } = useSession();
  const { offline, client } = useApiAccess();
  return { session, bootstrap, offlineBootstrap, offline,
    loading: enabled && status === "loading",
    canRetry: enabled && !!session && !bootstrap && !offline && !!client,
    retry: () => { void refreshSession(); } };
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
