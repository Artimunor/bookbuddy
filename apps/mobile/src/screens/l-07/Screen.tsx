import { View } from "react-native";
import { useLocale, useT } from "../../i18n";
import { nativeCard, type StatusCardSource } from "../../system/status-cards/model";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

/** Preview only. The production surface is rendered by the platform status-card module. */
export function SessionCardView({ source, now, area = "lock-screen", hidden = false }: {
  source: StatusCardSource; now: number; area?: "lock-screen" | "island" | "android"; hidden?: boolean;
}) {
  const { color, radius, space } = useBeaconTheme();
  const t = useT();
  const { locale } = useLocale();
  const zone = source.zone;
  const endAt = source.facts?.kind === "session" ? source.facts.endsAt : now;
  const card = nativeCard(source, { t, locale, displayZone: zone }, hidden, now, endAt);
  const surface = card?.details ?? card?.preview;
  const clock = new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(now);
  const date = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "full" }).format(now);
  const background = area === "android" ? color.subtle : color.personC;
  return <View style={{ flex: 1, backgroundColor: background, padding: space.contentInset, gap: space.grid[4] }}>
    <View accessible accessibilityLabel={surface?.accessibilityLabel} style={{ gap: space.grid[1], alignItems: "center", borderRadius: radius.pill, alignSelf: "center", backgroundColor: color.night, paddingHorizontal: space.grid[4], paddingVertical: space.grid[2], flexDirection: "row" }}>
      <Copy aria-hidden style={{ color: color.onNight }}>◈</Copy>
      {area === "island" && <Copy variant="caption" style={{ color: color.onNight }}>{t("mobile.sessionCard.compactOpen")}</Copy>}
    </View>
    <Copy variant="label" style={{ textAlign: "center" }}>{date}</Copy>
    <Copy variant="display" style={{ textAlign: "center" }}>{clock}</Copy>
    {area !== "island" && (surface ? <View accessible accessibilityLabel={surface.accessibilityLabel} style={{ marginTop: "auto", marginBottom: space.grid[8], backgroundColor: color.night, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <Copy variant="sectionTitle" style={{ color: color.onNight }}>{surface.title}</Copy>
        {surface.timerUntil !== null && <Copy variant="label" style={{ color: color.live }}>{t("mobile.cover.minutes", { count: Math.ceil((surface.timerUntil - now) / 60_000) })}</Copy>}
      </View>
      {!!surface.steps && <View aria-hidden style={{ flexDirection: "row", gap: space.grid[1] }}>
        {Array.from({ length: surface.steps }, (_, index) => <View key={index} style={{ flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: index < (surface.progress ?? 0) ? color.live : color.nightLine }} />)}
      </View>}
      <Copy style={{ color: color.onNight }}>{surface.summary}</Copy>
      {surface.expanded && <Copy variant="supporting" style={{ color: color.nightMuted }}>{surface.expanded}</Copy>}
    </View> : <Copy variant="supporting" style={{ marginTop: "auto", textAlign: "center" }}>{t("mobile.sessionCard.ended")}</Copy>)}
  </View>;
}
