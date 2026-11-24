import { useRouter, type Href } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { defaultPushSettings, enablePush, loadPushSettings, revokePush, savePushSettings, type PushSettings } from "../../system/push";
import { Button, Card, Screen, SwitchRow } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

export default function PrivacyScreen() {
  const router = useRouter(); const { session } = useSession(); const { client } = useApiAccess();
  const [settings, setSettings] = useState<PushSettings>(defaultPushSettings); const [busy, setBusy] = useState(false); const [error, setError] = useState<"unavailable" | "unsaved" | null>(null);
  useEffect(() => { void loadPushSettings().then(setSettings); }, []);
  async function change(patch: Partial<PushSettings>) {
    if (busy) return; setBusy(true); setError(null);
    try {
      if (patch.notifications === true) {
        if (!client || !session) throw new Error("No session");
        setSettings(await enablePush(client, session.accountId));
      } else if (patch.notifications === false) {
        if (session) await revokePush(client, session.accountId);
        const next = { ...(await loadPushSettings()), notifications: false }; await savePushSettings(next); setSettings(next);
      } else { const next = { ...settings, ...patch }; await savePushSettings(next); setSettings(next); }
    } catch (cause) { setError(cause instanceof Error && cause.message === "Push project is not configured" ? "unavailable" : "unsaved"); } finally { setBusy(false); }
  }
  return <PrivacyView role={session?.activeContext?.role === "customer" ? "customer" : "worker"} settings={settings} busy={busy} error={error}
    onChange={(patch) => { void change(patch); }} onBack={() => router.canGoBack() ? router.back() : router.replace("/you" as Href)}
    onSettings={() => { void Linking.openSettings(); }} />;
}

export function PrivacyView({ role, settings, busy = false, error = null, onChange, onBack, onSettings }: {
  role: "customer" | "worker"; settings: PushSettings; busy?: boolean; error?: "unavailable" | "unsaved" | null;
  onChange: (patch: Partial<PushSettings>) => void; onBack: () => void; onSettings: () => void;
}) {
  const t = useT(); const { color, radius, space } = useBeaconTheme(); const worker = role === "worker";
  return <Screen title={t("mobile.privacy.title")} navigation={{ kind: "back", label: t("mobile.privacy.back"), onPress: onBack }}>
    <Copy variant="supporting">{t("mobile.privacy.intro")}</Copy>
    <Card>
      <SwitchRow label={t("mobile.privacy.push")} description={t("mobile.privacy.pushDescription")} value={settings.notifications} disabled={busy} onValueChange={(notifications) => onChange({ notifications })} />
      {!settings.notifications && <Button variant="quiet" label={t("mobile.privacy.phoneSettings")} onPress={onSettings} />}
      <SwitchRow label={Platform.OS === "android" ? t("mobile.privacy.ongoing") : t("mobile.privacy.lockScreen")} description={t("mobile.privacy.liveDescription")} value={settings.liveSurface} disabled={busy} onValueChange={(liveSurface) => onChange({ liveSurface })} />
      <SwitchRow label={t("mobile.privacy.hideDetails")} description={t("mobile.privacy.hideDescription")} value={settings.hideDetails} disabled={busy} onValueChange={(hideDetails) => onChange({ hideDetails })} />
      <Copy variant="supporting">{t("mobile.privacy.later")}</Copy>
      {error && <Copy accessibilityRole="alert">{error === "unavailable" ? t("mobile.privacy.pushUnavailable") : t("mobile.privacy.notSaved")}</Copy>}
    </Card>
    <Copy variant="label">{t("mobile.privacy.preview")}</Copy>
    <View accessible accessibilityLabel={worker ? (settings.hideDetails ? t("mobile.privacy.workerHidden") : t("mobile.privacy.workerDetailed")) : (settings.hideDetails ? t("mobile.privacy.customerHidden") : t("mobile.privacy.customerDetailed"))} style={{ backgroundColor: color.night, borderRadius: radius.card, padding: space.cardPadding, gap: 8 }}>
      <Copy style={{ color: color.onNight }} variant="label">{t("mobile.privacy.example")}</Copy>
      <Copy style={{ color: color.onNight }} variant="sectionTitle">{worker ? (settings.hideDetails ? t("mobile.privacy.workerHidden") : t("mobile.privacy.workerDetailed")) : (settings.hideDetails ? t("mobile.privacy.customerHidden") : t("mobile.privacy.customerDetailed"))}</Copy>
    </View>
    <Copy variant="sectionTitle">{worker ? t("mobile.privacy.workerAudience") : t("mobile.privacy.customerAudience")}</Copy>
    <Card><Copy>{worker ? t("mobile.privacy.foremanSees") : t("mobile.privacy.customerSees")}</Copy>{worker && <Copy>{t("mobile.privacy.customerCrew")}</Copy>}</Card>
    <Card><Copy variant="label">{t("mobile.privacy.noLocation")}</Copy><Copy>{t("mobile.privacy.noLocationDescription")}</Copy></Card>
  </Screen>;
}
