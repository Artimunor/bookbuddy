import { type LocaleTag } from "@bookbuddy/i18n/locales";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useLocale, useT } from "../../i18n";
import { Card, Dock, Screen, SegmentedControl, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { LiveCapsule } from "../../ui/live/LiveCapsule";
import { useBeaconTheme } from "../../ui/theme";
import { authFlow } from "../s-02/flow";

export default function WelcomeScreen() {
  const router = useRouter();
  const { opaque, linkKind } = useLocalSearchParams<{ opaque?: string; linkKind?: string }>();
  useEffect(() => { if (opaque) authFlow.keepLink(opaque); }, [opaque]);
  return <WelcomeView link={opaque || authFlow.hasLink ? linkKind === "update" ? "update" : "invite" : undefined}
    onStart={() => { if (opaque) authFlow.keepLink(opaque); router.push("/sign-in"); }} />;
}

export function WelcomeView({ link, onStart }: { link?: "invite" | "update"; onStart: () => void }) {
  const { locale, deviceLanguageSupported, explicitChoice, chooseLocale, ready } = useLocale();
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const arrival = "09:10–09:20";
  const provenance = t("mobile.auth.welcome.sharedBy", { name: "Mateo", time: "08:52" });
  const stage = t("mobile.auth.welcome.onWay");
  const label = t("mobile.auth.welcome.capsule", { source: provenance, time: arrival });
  const options = [
    { value: "en", label: t("mobile.auth.welcome.english") },
    { value: "pt-PT", label: t("mobile.auth.welcome.portuguese") },
  ] satisfies { value: LocaleTag; label: string }[];

  return (
    <Screen title={t("shared.app.name")} trailing={
      <View aria-hidden style={{ backgroundColor: color.night, borderRadius: radius.pill, width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
        <SymbolView name={{ ios: "dot.radiowaves.left.and.right", android: "radio_button_checked", web: "radio_button_checked" }} size={24} tintColor={color.live} />
      </View>
    } dock={<Dock context={t("mobile.auth.welcome.next")}
      primary={{ label: t("mobile.auth.welcome.start"), disabled: !ready, onPress: onStart }} />}>
      <View style={{ gap: space.grid[2] }}>
        <Copy variant="pageTitle" accessibilityRole="header">{t("mobile.auth.welcome.title")}</Copy>
        <Copy>{t("mobile.auth.welcome.intro")}</Copy>
      </View>
      <LiveCapsule state="onTheWay" pulse={false} source={t("mobile.auth.welcome.repair")}
        reference={t("mobile.auth.welcome.example")} stateLabel={stage} time={arrival}
        zoneLine={t("mobile.auth.welcome.arrival")} provenance={provenance} accessibilityLabel={label}
        line={{ kind: "visit", current: 1, accessibilityLabel: stage, steps: [t("mobile.auth.welcome.confirmed"), stage,
          t("mobile.auth.welcome.onSite"), t("mobile.auth.welcome.working"), t("mobile.auth.welcome.finished")] }} />
      <View style={{ gap: space.grid[1] }}>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.welcome.lockScreen")}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.auth.welcome.notification")}</Copy>
      </View>
      <Card dense>
        <SegmentedControl label={t("mobile.auth.welcome.appLanguage")} options={options} value={locale}
          onChange={(next) => { void chooseLocale(next); }} />
        <Copy variant="supporting" style={{ color: color.muted }}>
          {deviceLanguageSupported || explicitChoice !== null ? t("mobile.auth.welcome.supported") : t("mobile.auth.welcome.unsupported")}
        </Copy>
      </Card>
      {link && <View style={{ borderRadius: radius.input }}>
        <StatusBanner state="last-confirmed" label={link === "invite" ? t("mobile.auth.welcome.invite") : t("mobile.auth.welcome.update")} />
      </View>}
    </Screen>
  );
}
