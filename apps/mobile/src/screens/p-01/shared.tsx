import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, IdentityChip, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

export function useProvider() {
  const { session, bootstrap, offlineBootstrap } = useSession();
  const context = session?.activeContext;
  return { businessId: context?.role === "provider_admin" ? context.businessId ?? "" : "",
    actor: bootstrap?.account.displayName ?? offlineBootstrap?.account.displayName ?? bootstrap?.account.email ?? "" };
}

export function ProviderScreen({ title, business, children, dock }: { title: string; business?: string; children: ReactNode; dock?: ReactNode }) {
  const router = useRouter(); const { actor } = useProvider();
  return <ProviderScreenView title={title} business={business} actor={actor} dock={dock} onProfile={() => router.push("/you" as Href)} onNotifications={() => router.push("/notifications" as Href)}>{children}</ProviderScreenView>;
}

export function ProviderScreenView({ title, subtitle, business, actor, children, dock, onProfile, onNotifications }: { title: string; subtitle?: string; business?: string; actor: string; children: ReactNode; dock?: ReactNode; onProfile: () => void; onNotifications: () => void }) {
  const t = useT();
  return <Screen title={title} subtitle={subtitle} identity={<IdentityChip initials={actor.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()} name={actor} person="personB" context={[t("mobile.provider.admin"), business].filter(Boolean).join(" · ")} onPress={onProfile} />}
    bell={<Button label={t("mobile.provider.notifications")} glyph="🔔︎" iconOnly variant="neutral" onPress={onNotifications} />} dock={dock}>{children}</Screen>;
}

export function useProviderFormat() {
  const format = useFormat(); const t = useT();
  return { ...format, siteTime: (at: number, zone: string | null | undefined) => {
    const result = format.siteTime(at, zone);
    return result.kind === "available" ? result.siteTime : t("mobile.provider.unavailable");
  } };
}

export function ReadState({ status, retry }: { status: string; retry: () => void }) {
  const t = useT();
  if (status === "ready") return null;
  if (status === "loading" || status === "idle") return <Copy>{t("mobile.provider.loading")}</Copy>;
  return <><Copy>{t("mobile.provider.unavailable")}</Copy><Button label={t("mobile.provider.retry")} onPress={retry} /></>;
}

export function useProviderLabels() {
  const t = useT();
  return {
    role: (role: string) => role === "provider_admin" ? t("mobile.provider.admin") : role === "foreman" ? t("mobile.provider.foremanRole") : t("mobile.provider.worker"),
    eligibility: (status: string) => status === "approved" ? t("mobile.provider.approved") : status === "expiring" ? t("mobile.provider.expiring") : status === "expired" ? t("mobile.provider.expired") : status === "suspended" ? t("mobile.provider.suspended") : status === "rejected" ? t("mobile.provider.rejected") : status === "closed" ? t("mobile.provider.closed") : t("mobile.provider.pending"),
    visit: (step: "confirmed" | "on_the_way" | "on_site" | "working" | "finished") => ({ confirmed: t("mobile.foremanHome.confirmed"), on_the_way: t("mobile.foremanHome.onWay"), on_site: t("mobile.foremanHome.onSite"), working: t("mobile.foremanHome.working"), finished: t("mobile.foremanHome.finished") })[step],
    journey: (step: "requested" | "quoted" | "booked" | "visit" | "signed_off" | "paid", cancelled: boolean) => cancelled ? t("mobile.foremanHome.cancelled") : ({ requested: t("mobile.foremanHome.requested"), quoted: t("mobile.foremanHome.quoted"), booked: t("mobile.foremanHome.booked"), visit: t("mobile.foremanHome.visit"), signed_off: t("mobile.foremanHome.signedOff"), paid: t("mobile.foremanHome.paid") })[step],
  };
}
