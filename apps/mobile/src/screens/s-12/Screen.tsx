import type { LocaleTag } from "@bookbuddy/i18n/locales";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useFormat, useLocale, useT } from "../../i18n";
import { Button, Card, ListRow, Screen, Sheet, StatusBanner, SwitchRow } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { DirectedText } from "../../ui/live/parts";
import { TwoClock } from "../../ui/live/TwoClock";
import { useBeaconTheme, type BeaconAppearance } from "../../ui/theme";
import { isolated, useAccountDetails } from "../s-06/account";
import { ChoiceRadio } from "./ChoiceRadio";
import { appLanguageLabel, readingLanguageLabel, readingLanguages } from "./language";
import { useDisplaySettings, type DisplaySettings } from "./preferences";

const appLocales = ["en", "pt-PT"] as const;
const themes = ["system", "light", "dark"] as const;
const exampleTime = Date.UTC(2026, 10, 24, 8);
const siteZone = "Europe/Madrid";

type SettingsStatus = "saving" | "checking" | "unsaved" | "pending" | "offline";

export default function LanguageAndDisplayScreen() {
  const router = useRouter();
  const locale = useLocale();
  const { session, bootstrap, offline, canRetry, retry: retryAccount } = useAccountDetails();
  const display = useDisplaySettings();
  const phase = display.phase;
  const status = phase === "saving" || display.choosingLocale ? "saving"
    : phase === "checking" ? "checking" : phase ? "unsaved" : locale.pending ? "pending"
      : session && offline ? "offline" : undefined;
  const choiceLocked = display.choosingLocale || (phase !== undefined && phase !== "unsaved");
  const retry = phase === "checking" || phase === "local" ? () => { void display.retry(); }
    : locale.pending && !!bootstrap && !offline && !choiceLocked ? () => { void display.chooseLocale(locale.locale); }
      : canRetry ? retryAccount : undefined;
  return <DisplayView
    signedIn={!!session} name={bootstrap?.account.displayName ?? undefined} settings={display.settings}
    appLanguageDisabled={!locale.ready || choiceLocked} settingsDisabled={!bootstrap || offline || choiceLocked}
    status={session ? status : undefined} onRetry={retry} retryDisabled={offline && phase !== "local"}
    onLanguage={(next) => { void display.chooseLocale(next); }} onSetting={(patch) => { void display.save(patch); }}
    onBack={() => { if (router.canGoBack()) router.back(); else router.replace(session?.activeContext ? "/you" : "/welcome"); }} />;
}

export function DisplayView({ signedIn, name, settings, viewerZone, status, settingsDisabled, appLanguageDisabled,
  onLanguage, onSetting, onBack, onRetry, retryDisabled }: {
  signedIn: boolean;
  name?: string;
  settings: DisplaySettings;
  viewerZone?: string;
  status?: SettingsStatus;
  settingsDisabled?: boolean;
  appLanguageDisabled?: boolean;
  onLanguage: (next: LocaleTag) => void;
  onSetting: (patch: Partial<DisplaySettings>) => void;
  onBack: () => void;
  onRetry?: () => void;
  retryDisabled?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { color, space } = useBeaconTheme();
  const [open, setOpen] = useState<"reading" | "appearance">();
  const appTitle = t("mobile.auth.welcome.appLanguage");
  const readingTitle = t("mobile.auth.setup.reading");
  const appearanceTitle = t("mobile.display.appearance");
  const pendingLabel = status === "saving" ? t("mobile.display.saving")
    : status === "checking" ? t("mobile.display.checking") : status === "unsaved" ? t("mobile.display.unsaved")
      : status === "pending" ? t("mobile.display.pending") : t("mobile.display.offline");
  const themeLabel = (value: BeaconAppearance) => value === "system" ? t("mobile.display.system")
    : value === "light" ? t("mobile.display.light") : t("mobile.display.dark");
  const back = { kind: "back", label: t("shared.action.back"), iconOnly: true, onPress: onBack } as const;

  return <Screen title={t("mobile.display.title")} navigation={back}>
    {!signedIn && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.display.local")}</Copy>}
    {signedIn && name && !status && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.display.account", { name: isolated(name) })}</Copy>}
    <Card>
      <Copy variant="sectionTitle" accessibilityRole="header">{appTitle}</Copy>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.display.appHint")}</Copy>
      <View accessibilityRole="radiogroup" accessibilityLabel={appTitle} style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[2] }}>
        {appLocales.map((tag) => <ChoiceRadio key={tag} label={appLanguageLabel(t, tag)} selected={locale === tag}
          disabled={appLanguageDisabled} pill onPress={() => onLanguage(tag)} />)}
      </View>
      {!signedIn && <Copy variant="supporting" style={{ color: color.muted }}>
        {t("mobile.auth.welcome.example")}: {t("shared.action.back")} · {t("shared.action.continue")}
      </Copy>}
      {status && <StatusBanner state={status === "offline" ? "offline" : "not-sent"} label={pendingLabel} />}
      {onRetry && <Button variant="quiet" label={status === "pending" ? t("mobile.you.save") : t("mobile.you.retry")}
        disabled={retryDisabled} onPress={onRetry} />}
    </Card>
    {signedIn && <>
      <Card>
        <ListRow label={readingTitle} description={t("mobile.display.readingHint")}
          accessibilityLabel={`${readingTitle}, ${readingLanguageLabel(t, settings.readingLocale)}`}
          disabled={settingsDisabled} onPress={() => setOpen("reading")}
          trailing={<Copy variant="supporting" style={{ color: color.muted, maxWidth: "38%" }}>
            {isolated(readingLanguageLabel(t, settings.readingLocale))}
          </Copy>} />
        <MessageExample translated={settings.readingLocale !== null} />
        <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.display.originals")}</Copy>
      </Card>
      <Card>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.display.section")}</Copy>
        <SwitchRow label={t("mobile.auth.setup.twoClocks")} description={t("mobile.display.clocksHint")}
          value={settings.twoClock} disabled={settingsDisabled} onValueChange={(twoClock) => onSetting({ twoClock })} />
        <ClockExample twoClock={settings.twoClock} zone={viewerZone} />
        <SwitchRow label={t("mobile.display.field")} description={t("mobile.display.fieldHint")}
          value={settings.fieldMode} disabled={settingsDisabled} onValueChange={(fieldMode) => onSetting({ fieldMode })} />
        <ListRow label={appearanceTitle} description={t("mobile.display.appearanceHint")}
          accessibilityLabel={`${appearanceTitle}, ${themeLabel(settings.theme)}`}
          disabled={settingsDisabled} onPress={() => setOpen("appearance")}
          trailing={<Copy variant="supporting" style={{ color: color.muted, maxWidth: "38%" }}>{themeLabel(settings.theme)}</Copy>} />
      </Card>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.display.unchanged")}</Copy>
      <Sheet visible={open !== undefined} title={open === "appearance" ? appearanceTitle : readingTitle}
        closeLabel={t("shared.action.close")} onClose={() => setOpen(undefined)}>
        <View accessibilityRole="radiogroup" accessibilityLabel={open === "appearance" ? appearanceTitle : readingTitle} style={{ gap: space.grid[2] }}>
          {open === "appearance" ? themes.map((theme) => <ChoiceRadio key={theme} label={themeLabel(theme)} selected={settings.theme === theme}
            disabled={settingsDisabled} onPress={() => { setOpen(undefined); onSetting({ theme }); }} />)
            : readingLanguages.map((tag) => <ChoiceRadio key={tag ?? "original"} label={readingLanguageLabel(t, tag)} selected={settings.readingLocale === tag}
              disabled={settingsDisabled} onPress={() => { setOpen(undefined); onSetting({ readingLocale: tag }); }} />)}
        </View>
      </Sheet>
    </>}
  </Screen>;
}

function MessageExample({ translated }: { translated: boolean }) {
  const t = useT();
  const { color, type, radius, space } = useBeaconTheme();
  const side = { padding: space.grid[3], gap: space.grid[1] };
  return <View style={{ gap: space.grid[2] }}>
    <Copy variant="caption" style={{ color: color.muted }}>{translated ? t("mobile.display.preview") : t("mobile.display.originalPreview")}</Copy>
    <View style={{ borderWidth: 1, borderColor: color.separator, borderRadius: radius.card, overflow: "hidden" }}>
      {translated && <View style={side}>
        <Copy variant="caption" style={{ color: color.brandInk }}>{t("mobile.display.translation", { language: readingLanguageLabel(t, "en") })}</Copy>
        <DirectedText dir="ltr" lang="en" style={[type.body, { color: color.ink }]}>{t("mobile.display.exampleEn")}</DirectedText>
      </View>}
      <View style={[side, { backgroundColor: color.subtle }]}>
        <Copy variant="caption" style={{ color: color.muted }}>{t("mobile.display.original", { language: readingLanguageLabel(t, "es") })}</Copy>
        <DirectedText dir="ltr" lang="es" style={[type.body, { color: color.ink }]}>{t("mobile.display.exampleEs")}</DirectedText>
      </View>
    </View>
  </View>;
}

function ClockExample({ twoClock, zone }: { twoClock: boolean; zone?: string }) {
  const t = useT();
  const format = useFormat();
  const { color, radius, space } = useBeaconTheme();
  const clocks = format.twoClock(exampleTime, siteZone, twoClock ? zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  if (clocks.kind !== "available") return null;
  return <View style={{ backgroundColor: color.subtle, padding: space.grid[3], borderRadius: radius.input, gap: space.grid[1] }}>
    <Copy variant="caption" style={{ color: color.muted }}>{t("mobile.auth.setup.example")}</Copy>
    <TwoClock siteTime={clocks.siteTime} siteZone={t("mobile.auth.setup.siteZone")}
      viewerLine={clocks.viewerTime ? t("mobile.auth.setup.viewerWindow", { time: clocks.viewerTime }) : undefined} />
  </View>;
}
