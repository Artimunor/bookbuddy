import { native } from "@bookbuddy/design-tokens";
import { projectStatusCard } from "@bookbuddy/domain";
import { View } from "react-native";
import { useLocale, useT } from "../../i18n";
import { nativeCard, type StatusCardSource } from "../../system/status-cards/model";
import { Copy } from "../../ui/controls/shared";
import { JobLine } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { useSessionDisplay } from "../l-01/common";

/** Preview only. The production surface is rendered by the platform status-card module. */
export function SessionCardView({ source, now, area = "lock-screen", hidden = false }: {
  source: StatusCardSource; now: number; area?: "lock-screen" | "island" | "android"; hidden?: boolean;
}) {
  const { color, radius, space } = useBeaconTheme();
  const t = useT();
  const { locale } = useLocale();
  const zone = source.zone;
  const display = useSessionDisplay(zone);
  const facts = source.facts?.kind === "session" ? source.facts : null;
  const endAt = facts?.endsAt ?? now;
  const card = nativeCard(source, { t, locale, displayZone: zone }, hidden, now, endAt);
  const surface = card?.details ?? card?.preview;
  const projected = card?.details && facts ? projectStatusCard(facts, now, "details") : null;
  const details = projected?.kind === "session" && projected.preview === "details" ? projected : null;
  const clock = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(now);
  const date = new Intl.DateTimeFormat(locale, { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(now);
  const steps = [t("mobile.laterCustomer.booked"), t("mobile.laterCustomer.today"), t("mobile.laterCustomer.doorsOpen"), t("mobile.laterCustomer.inSession"), t("mobile.laterCustomer.done")] as const;
  const stage = surface?.progress === 4 ? 3 : surface?.progress === 3 ? 2 : 1;
  const times = details ? display.clock(details.startsAt, details.endsAt, zone) : null;
  return <View style={{ flex: 1, overflow: "hidden", backgroundColor: color.subtle, padding: space.grid[3], gap: space.grid[2] }}>
    {area === "lock-screen" && <>
      <View aria-hidden style={{ position: "absolute", top: "12%", end: -90, width: 300, height: 300, borderRadius: radius.pill, backgroundColor: color.personA }} />
      <View aria-hidden style={{ position: "absolute", top: "33%", start: -150, width: 380, height: 380, borderRadius: radius.pill, backgroundColor: color.personB }} />
    </>}
    {area !== "android" && <View accessible={area === "island"} accessibilityLabel={area === "island" ? surface?.accessibilityLabel : undefined}
      style={{ minWidth: 126, minHeight: 36, gap: space.grid[1], alignItems: "center", justifyContent: "center", borderRadius: radius.pill,
        alignSelf: "center", backgroundColor: color.night, paddingHorizontal: space.grid[4], flexDirection: "row" }}>
      {area === "island" && <>
        <Copy aria-hidden style={{ color: color.onNight }}>◈</Copy>
        <Copy variant="caption" style={{ color: color.onNight }}>{t("mobile.sessionCard.compactOpen")}</Copy>
      </>}
    </View>}
    {area === "lock-screen" && <>
      <Copy variant="sectionTitle" style={{ textAlign: "center", marginTop: space.grid[8] }}>{date}</Copy>
      <Copy variant="display" style={[native.tabularNumbers, { textAlign: "center", fontSize: 76, lineHeight: 84 }]}>{clock}</Copy>
    </>}
    {area !== "island" && (surface ? <View accessible accessibilityLabel={surface.accessibilityLabel} style={{
      marginTop: area === "lock-screen" ? "auto" : space.grid[4], marginBottom: area === "lock-screen" ? 120 : 0,
      backgroundColor: color.night, borderRadius: native.componentMetrics.liveCapsule.pillRadius, padding: space.grid[4], gap: space.grid[1],
    }}>
      {details && <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: space.grid[2] }}>
        <Copy variant="supporting" style={{ color: color.onNight }}>○ {details.providerName}</Copy>
        <Copy variant="caption" style={{ color: color.nightMuted }}>{details.reference}</Copy>
      </View>}
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: space.grid[2] }}>
        <Copy variant="pageTitle" style={{ color: color.onNight }}>{surface.title}</Copy>
        {surface.timerUntil !== null && <Copy variant="sectionTitle" style={{ color: color.live }}>{t("mobile.laterCustomer.shortMinutes", { count: Math.ceil((surface.timerUntil - now) / 60_000) })}</Copy>}
      </View>
      {!!surface.steps && <JobLine kind="visit" steps={steps} current={stage} pulse={false} compact surface="capsule"
        accessibilityLabel={t("mobile.laterCustomer.step", { step: stage + 1 })} />}
      <Copy variant="supporting" style={{ color: color.onNight }}>{times ? `${times.time} · ${times.zone}` : surface.summary}</Copy>
      {surface.expanded && <Copy variant="supporting" style={{ color: color.nightMuted }}>{surface.expanded}</Copy>}
    </View> : <Copy variant="supporting" style={{ marginTop: "auto", textAlign: "center" }}>{t("mobile.sessionCard.ended")}</Copy>)}
  </View>;
}
