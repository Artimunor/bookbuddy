import { getSessionRoute, sessionListingIdSchema, type CustomerSessionDetail } from "@bookbuddy/api-contract";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { browseHref, holdHref, Separator, SessionState, useSessionDisplay, useSessionsBack } from "../l-01/common";

export function useSessionDetail(id: string, cursor?: string, loadOnMount = true) {
  return useRemote(getSessionRoute, { params: { id }, ...(cursor ? { query: { cursor } } : {}) }, { enabled: sessionListingIdSchema.safeParse(id).success, loadOnMount });
}

export default function SessionDetailScreen() {
  const { listingId = "" } = useLocalSearchParams<{ listingId: string }>();
  const router = useRouter();
  const t = useT();
  const onBack = useSessionsBack(browseHref);
  const remote = useSessionDetail(listingId);
  if (remote.error?.code === "NOT_FOUND") return <Redirect href={{ pathname: "/help", params: { reason: "generic" } } as Href} />;
  if (remote.status !== "ready" || remote.data.audience !== "customer") {
    const state = !sessionListingIdSchema.safeParse(listingId).success || remote.status === "ready" ? "unavailable" :
      remote.status === "offline" ? "offline" : remote.status === "error" ? "error" : "loading";
    return <SessionState title={t("mobile.laterCustomer.sessions")} state={state} onBack={onBack} retry={() => { void remote.refresh(); }} />;
  }
  return <DetailView detail={remote.data} onBack={onBack} onChoose={() => router.push(holdHref(listingId))}
    onBrowse={() => router.dismissTo(browseHref)} />;
}

export function DetailView({ detail, viewerZone, onBack, onChoose, onBrowse }: {
  detail: CustomerSessionDetail; viewerZone?: string; onBack: () => void; onChoose?: () => void; onBrowse: () => void;
}) {
  const t = useT();
  const display = useSessionDisplay(viewerZone);
  const { color } = useBeaconTheme();
  const available = detail.availability === "available";
  const full = detail.availability === "full";
  const slot = detail.slots.find(item => item.id === detail.nextSlotId) ?? detail.slots.find(item => item.state === "published" && item.placesLeft > 0);
  const version = (slot && detail.versions.find(item => item.id === slot.listingVersionId)) ?? detail.versions[0];
  const clock = slot && version ? display.clock(slot.startsAt, slot.endsAt, version.venue.siteZone) : null;
  const host = slot?.host;
  const chooseLabel = t("mobile.laterCustomer.chooseTime");
  const browse = { label: t("mobile.laterCustomer.browseOther"), onPress: onBrowse };
  return <Screen title={version?.title ?? t("mobile.laterCustomer.sessions")} navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack }}
    dock={onChoose ? <Dock primary={available ? { label: chooseLabel, onPress: onChoose } : browse}
      context={available ? undefined : full ? t("mobile.laterCustomer.noPublishedPlaces") : t("mobile.laterCustomer.bookingUnavailable")} /> : undefined}>
    {!!version && <Copy variant="supporting">{version.venue.name} · {version.venue.locality}</Copy>}
    <Card>
      <Copy variant="label">{clock && available ? `${t("mobile.laterCustomer.nextSession")} · ${clock.date}` : t("mobile.laterCustomer.nextSession")}</Copy>
      {available && clock ? <TwoClock siteTime={clock.time} siteZone={clock.zone} viewerLine={clock.viewer} size="hero" /> :
        <Copy variant="display">{full ? t("mobile.laterCustomer.full") : available ? t("mobile.laterCustomer.available") : t("mobile.laterCustomer.bookingUnavailable")}</Copy>}
      {!!slot && version?.format === "group" && (available || full) && <>
        <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {Array.from({ length: Math.min(slot.capacity, 32) }, (_, i) => <View key={i} style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 2,
            backgroundColor: i < slot.capacity - slot.placesLeft ? color.ink : color.surface, borderColor: i < slot.capacity - slot.placesLeft ? color.ink : color.outline }} />)}
        </View>
        <Copy accessibilityLiveRegion="polite">{t("mobile.laterCustomer.capacity", { count: slot.placesLeft, capacity: slot.capacity })}{full ? ` · ${t("mobile.laterCustomer.noWaitlist")}` : ""}</Copy>
      </>}
      {available && version?.format === "private" && <Copy>{t("mobile.laterCustomer.appointmentAvailable")}</Copy>}
      {!!version && <Copy variant="supporting">{t("mobile.laterCustomer.minutes", { count: Math.round(version.durationMs / 60_000) })}</Copy>}
    </Card>
    <Card>
      <Copy variant="sectionTitle">{t("mobile.laterCustomer.host")}</Copy>
      {host ? <><Copy variant="label">{host.name}</Copy><Copy variant="supporting">{t("mobile.laterCustomer.taughtIn", { language: display.language(host.language) })}</Copy></> : <Copy>{t("mobile.laterCustomer.hostUnconfirmed")}</Copy>}
    </Card>
    {!!version && <Card>
      <Copy variant="label">{t("mobile.laterCustomer.taughtIn", { language: display.language(version.language) })}</Copy>
      <Separator /><Copy>{version.venue.accessNote}</Copy>
      <Separator /><Copy variant="label">{display.price(version.price)}</Copy>
      <Copy variant="supporting">{t("mobile.laterCustomer.payProvider", { name: detail.provider.name })}</Copy>
      <Copy variant="supporting">{t("mobile.laterCustomer.noPayment")}</Copy>
      {!!slot && <><Separator /><Copy>{t("mobile.laterCustomer.freeUntil", { time: display.absolute(slot.freeCancellationUntil, version.venue.siteZone) })}</Copy></>}
    </Card>}
  </Screen>;
}
