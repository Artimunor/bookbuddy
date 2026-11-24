import { useRouter, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { Linking, Platform } from "react-native";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { defaultPushSettings, enablePush, loadPushSettings, revokePush, savePushSettings, type PushSettings } from "../../system/push";
import { useStatusCards } from "../../system/status-cards";
import { Button, Card, Screen, SwitchRow } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

export default function PrivacyScreen() {
  const router = useRouter(); const { session } = useSession(); const { client } = useApiAccess();
  const [settings, setSettings] = useState<PushSettings>(defaultPushSettings); const [busy, setBusy] = useState(false); const [error, setError] = useState<"unavailable" | "unsaved" | null>(null);
  const { preferences, active, stop, changePreferences } = useStatusCards();
  const t = useT();
  const role = session?.activeContext?.role;
  const [cardBusy, setCardBusy] = useState(false); const [cardError, setCardError] = useState(false);
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
  async function changeCard(action: () => Promise<void>) {
    if (cardBusy) return; setCardBusy(true); setCardError(false);
    try { await action(); } catch { setCardError(true); } finally { setCardBusy(false); }
  }
  const cardControls = preferences.statusCardsEnabled && (role === "customer" || role === "worker" || role === "foreman") ? <Card>
    <Copy variant="label">{Platform.OS === "android" ? t("mobile.privacy.ongoing") : t("mobile.privacy.lockScreen")}</Copy>
    <SwitchRow label={t("mobile.privacy.hideDetails")} description={t("mobile.statusCards.hideDescription")} value={preferences.hideDetails} disabled={cardBusy}
      onValueChange={hideDetails => { void changeCard(() => changePreferences({ hideDetails })); }} />
    {role === "worker" && <SwitchRow label={t("mobile.liveShift.shiftCard")} description={t("mobile.liveShift.cardDescription")} value={preferences.workerOptIn === true} disabled={cardBusy}
      onValueChange={workerOptIn => { void changeCard(() => changePreferences({ workerOptIn })); }} />}
    {role === "foreman" && <SwitchRow label={t("mobile.statusCards.coverPreference")} description={t("mobile.statusCards.coverDescription")} value={preferences.coverOptIn} disabled={cardBusy}
      onValueChange={coverOptIn => { void changeCard(() => changePreferences({ coverOptIn })); }} />}
    {active && <Button variant="quiet" label={t("mobile.statusCards.stop")} disabled={cardBusy} onPress={() => { void changeCard(() => stop(active.id)); }} />}
    {cardError && <Copy accessibilityRole="alert">{t("mobile.statusCards.unavailable")}</Copy>}
  </Card> : undefined;
  return <PrivacyView role={role === "customer" ? "customer" : "worker"} settings={settings} busy={busy} error={error} cardControls={cardControls}
    onChange={(patch) => { void change(patch); }} onBack={() => router.canGoBack() ? router.back() : router.replace("/you" as Href)}
    onSettings={() => { void Linking.openSettings(); }} />;
}

export function PrivacyView({ role, settings, busy = false, error = null, cardControls, onChange, onBack, onSettings }: {
  role: "customer" | "worker"; settings: PushSettings; busy?: boolean; error?: "unavailable" | "unsaved" | null; cardControls?: ReactNode;
  onChange: (patch: Partial<PushSettings>) => void; onBack: () => void; onSettings: () => void;
}) {
  const t = useT(); const worker = role === "worker";
  return <Screen title={t("mobile.privacy.title")} navigation={{ kind: "back", label: t("mobile.privacy.back"), onPress: onBack }}>
    <Copy variant="supporting">{t("mobile.privacy.intro")}</Copy>
    <Card>
      <SwitchRow label={t("mobile.privacy.push")} description={t("mobile.privacy.pushDescription")} value={settings.notifications} disabled={busy} onValueChange={(notifications) => onChange({ notifications })} />
      {!settings.notifications && <Button variant="quiet" label={t("mobile.privacy.phoneSettings")} onPress={onSettings} />}
      {error && <Copy accessibilityRole="alert">{error === "unavailable" ? t("mobile.privacy.pushUnavailable") : t("mobile.privacy.notSaved")}</Copy>}
    </Card>
    {cardControls}
    <Copy variant="sectionTitle">{worker ? t("mobile.privacy.workerAudience") : t("mobile.privacy.customerAudience")}</Copy>
    <Card><Copy>{worker ? t("mobile.privacy.foremanSees") : t("mobile.privacy.customerSees")}</Copy>{worker && <Copy>{t("mobile.privacy.customerCrew")}</Copy>}</Card>
    <Card><Copy variant="label">{t("mobile.privacy.noLocation")}</Copy><Copy>{t("mobile.privacy.noLocationDescription")}</Copy></Card>
  </Screen>;
}
