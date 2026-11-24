import { useState } from "react";
import { PreviewLocaleProvider, useLocale } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { BeaconThemeProvider, useBeaconTheme } from "../../ui/theme";
import { DisplayView } from "./Screen";
import type { DisplaySettings } from "./preferences";

function Fixture({ signedIn = true, pending, originals }: { signedIn?: boolean; pending?: boolean; originals?: boolean }) {
  const { chooseLocale } = useLocale();
  const { scheme, field } = useBeaconTheme();
  const [settings, setSettings] = useState<DisplaySettings>({ readingLocale: originals ? null : "en", theme: "system", fieldMode: field, twoClock: true });
  return <BeaconThemeProvider scheme={settings.theme === "system" ? scheme : settings.theme} field={settings.fieldMode}>
    <DisplayView name="Claire Martin" signedIn={signedIn} viewerZone="Europe/London" settings={settings}
      status={pending ? "pending" : undefined} settingsDisabled={pending} onBack={() => {}}
      onLanguage={(next) => { void chooseLocale(next); }} onSetting={(patch) => setSettings((current) => ({ ...current, ...patch }))} />
  </BeaconThemeProvider>;
}

export const previews: ScreenPreview[] = [
  { id: "S-12", state: "default", render: () => <Fixture /> },
  { id: "S-12", state: "portuguese", render: () => <PreviewLocaleProvider initialLocale="pt-PT"><Fixture /></PreviewLocaleProvider> },
  { id: "S-12", state: "original-only", render: () => <Fixture originals /> },
  { id: "S-12", state: "pending-offline", render: () => <Fixture pending /> },
  { id: "S-12", state: "pre-auth", render: () => <Fixture signedIn={false} /> },
];
