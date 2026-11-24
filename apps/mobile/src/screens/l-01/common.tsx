import type { CustomerSessionDetail, SessionHoldProjection } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { View } from "react-native";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { EmptyState, Screen } from "../../ui/controls";
import { Copy, toneColors, type Tone } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

export const browseHref = "/c/sessions" as Href;
export const homeHref = "/c/(tabs)/now" as Href;
export const detailHref = (listingId: string) => ({ pathname: "/c/sessions/[listingId]", params: { listingId } }) as Href;
export const holdHref = (listingId: string, move?: string) => ({ pathname: "/c/sessions/[listingId]/hold", params: { listingId, ...(move ? { move } : {}) } }) as Href;
export const bookingHref = (id: string) => ({ pathname: "/c/session-bookings/[id]", params: { id } }) as Href;
export type Slot = CustomerSessionDetail["slots"][number];
export type Agreement = SessionHoldProjection["agreement"];
export const holdDuration = 10 * 60_000;

export function useSessionMarkets() {
  const { bootstrap } = useSession();
  const scope = bootstrap?.capabilities?.sessions;
  return scope && "areaIds" in scope ? scope.areaIds : undefined;
}

export function useSessionsBack(fallback = homeHref) {
  const router = useRouter();
  return () => { if (router.canGoBack()) router.back(); else router.replace(fallback); };
}

export function useSessionDisplay(viewerZone?: string) {
  const t = useT();
  const format = useFormat();
  const { locale } = useLocale();
  const displayZone = viewerZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const absolute = (at: number, zone: string) => format.lines(at, zone, displayZone)?.site ?? "";
  return {
    absolute,
    clock(start: number, end: number, zone: string) {
      const first = format.twoClock(start, zone, displayZone);
      const last = format.twoClock(end, zone, displayZone);
      if (first.kind !== "available" || last.kind !== "available") return { date: "", time: "", zone: "", viewer: undefined };
      const clockRange = (a: { time: string }, b: { time: string; date?: string | null }, timeZone: string) =>
        `${a.time}–${dayKey(start, timeZone) !== dayKey(end, timeZone) ? `${b.date ?? ""} ` : ""}${b.time}`;
      const viewer = first.viewer && last.viewer ? t("mobile.laterCustomer.yourTime", {
        time: [first.viewer.date, clockRange(first.viewer, last.viewer, displayZone)].filter(Boolean).join(" · "),
      }) : undefined;
      return { date: first.site.date ?? "", time: clockRange(first.site, last.site, zone), zone: format.zoneLabel(zone, first.site) ?? zone, viewer };
    },
    instant(at: number, zone: string) {
      const clock = format.twoClock(at, zone, displayZone);
      if (clock.kind !== "available") return { time: "", zone: "", viewer: undefined };
      return { time: clock.site.time, zone: format.zoneLabel(zone, clock.site) ?? zone, viewer: clock.viewer ? t("mobile.laterCustomer.yourTime", { time: [clock.viewer.date, clock.viewer.time].filter(Boolean).join(" · ") }) : undefined };
    },
    date(at: number, zone: string) {
      return new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: zone }).format(at);
    },
    language(tag: string) {
      try { return new Intl.DisplayNames(locale, { type: "language" }).of(tag) ?? tag; }
      catch { return tag; }
    },
    price(price: Agreement["version"]["price"]) {
      const amount = format.money(price.unitMinor, price.currency);
      return price.basis === "per_person" ? t("mobile.laterCustomer.perPerson", { amount }) : t("mobile.laterCustomer.perAppointment", { amount });
    },
  };
}

export function dayKey(at: number, zone: string): string {
  try { return new Intl.DateTimeFormat("sv-SE", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at); }
  catch { return new Date(at).toISOString().slice(0, 10); }
}

export function SessionState({ title, state, onBack, retry }: { title: string; state: "loading" | "unavailable" | "error" | "offline"; onBack: () => void; retry?: () => void }) {
  const t = useT();
  return <Screen title={title} navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack }}>
    {state === "loading" ? <SessionSkeleton /> : <EmptyState
      title={state === "offline" ? t("mobile.laterCustomer.offline") : t("mobile.laterCustomer.unavailable")}
      description={state === "offline" ? t("mobile.laterCustomer.connect") : state === "error" ? t("mobile.laterCustomer.loadError") : t("mobile.laterCustomer.unavailableBody")}
      action={state === "error" && retry ? { label: t("mobile.laterCustomer.retry"), onPress: retry } : undefined} />}
  </Screen>;
}

export function SessionSkeleton() {
  const { color, radius } = useBeaconTheme();
  const t = useT();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={t("mobile.laterCustomer.loading")} style={{ gap: 12 }}>
    {[0, 1, 2].map(n => <View key={n} aria-hidden style={{ height: 99, borderRadius: radius.card, backgroundColor: color.subtle }} />)}
  </View>;
}

export function Notice({ title, tone, children }: { title: string; tone: Tone; children?: ReactNode }) {
  const { color, radius, space } = useBeaconTheme();
  const { fill, ink } = toneColors(color, tone);
  return <View role="status" accessibilityLiveRegion="polite" style={{ backgroundColor: fill, padding: space.cardPadding, borderRadius: radius.card, gap: space.grid[2] }}>
    <Copy variant="label" style={{ color: ink }}>{title}</Copy>
    {children}
  </View>;
}

export function Separator() {
  const { color } = useBeaconTheme();
  return <View aria-hidden style={{ height: 1, backgroundColor: color.separator }} />;
}

export function SessionFact({ glyph, title, detail }: { glyph: string; title: string; detail?: string }) {
  const { color, radius, space } = useBeaconTheme();
  return <View style={{ flexDirection: "row", gap: space.grid[3], alignItems: "flex-start" }}>
    <View aria-hidden style={{ width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.smallTile, backgroundColor: color.subtle }}>
      <Copy variant="label">{glyph}</Copy>
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Copy variant="label">{title}</Copy>
      {!!detail && <Copy variant="supporting" style={{ color: color.muted }}>{detail}</Copy>}
    </View>
  </View>;
}
