import { useState } from "react";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { defaultPushSettings, type PushSettings } from "../../system/push";
import { Card, SwitchRow } from "../../ui/controls";
import { PrivacyView } from "./Screen";

function Fixture({ role = "customer", initial = {} }: { role?: "customer" | "worker"; initial?: Partial<PushSettings> }) {
  const t = useT();
  const [settings, setSettings] = useState({ ...defaultPushSettings, notifications: true, liveSurface: true, ...initial });
  return <PrivacyView role={role} settings={settings}
    preview={settings.liveSurface ? { hideDetails: settings.hideDetails } : undefined}
    cardControls={settings.liveSurface ? <Card dense>
      <SwitchRow label={t("mobile.privacy.hideDetails")} description={t("mobile.statusCards.hideDescription")} value={settings.hideDetails}
        onValueChange={hideDetails => setSettings(current => ({ ...current, hideDetails }))} />
    </Card> : undefined}
    onChange={(patch) => setSettings((old) => ({ ...old, ...patch }))} onBack={() => {}} onSettings={() => {}} />;
}
export const previews: ScreenPreview[] = [
  { id: "S-18", state: "customer", render: () => <Fixture /> },
  { id: "S-18", state: "worker", render: () => <Fixture role="worker" /> },
  { id: "S-18", state: "notifications-off", render: () => <Fixture initial={{ notifications: false, liveSurface: false }} /> },
  { id: "S-18", state: "details-allowed", render: () => <Fixture initial={{ hideDetails: false }} /> },
];
