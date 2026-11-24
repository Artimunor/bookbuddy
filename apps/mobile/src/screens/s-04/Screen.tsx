import { type AccountSettingsPatch, type SessionBootstrap } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useRouter } from "expo-router";
import { useRef, useState, type ComponentRef } from "react";
import { View } from "react-native";
import { useFormat, useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, ListRow, Screen, Sheet, StatusBanner, SwitchRow, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live/TwoClock";
import { useBeaconTheme } from "../../ui/theme";
import { afterAuthentication, useAuthClient, useOffline, viewerTime } from "../s-02/flow";

const siteZone = "Europe/Madrid";
const exampleStart = Date.UTC(2026, 10, 24, 8);
const exampleEnd = Date.UTC(2026, 10, 24, 9);
// These are reading preferences, not permissions to machine-translate a pair. No pair is reviewed at launch yet.
const readingTags = ["en", "es", "de", "ro", "ar", "pt-PT"] as const;

type Draft = { name: string; readingLocale: string | null; twoClock: boolean };
type Status = "offline" | "failed" | "checking" | "local-update";

export default function SetupScreen() {
  const router = useRouter();
  const auth = useAuthClient();
  const { bootstrap, session, status, acceptBootstrap } = useSession();
  const offline = useOffline();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadingRef = useRef(false);

  async function load() {
    if (!session || !auth || offline || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setLoadFailed(false);
    try {
      const result = await auth.getSession();
      if (!result.ok || result.data.account.id !== session.accountId) { setLoadFailed(true); return; }
      await acceptBootstrap(result.data);
      if (result.data.setup === "complete") afterAuthentication(router, result.data);
    } catch { setLoadFailed(true); }
    finally { loadingRef.current = false; setLoading(false); }
  }

  if (bootstrap) return <SetupForm key={bootstrap.account.id} session={bootstrap} />;
  const context = status === "loading" ? undefined : !session || loadFailed ? t("mobile.auth.common.unavailable") : t("mobile.auth.setup.load");
  return <Screen title={t("mobile.auth.setup.title")} dock={<Dock context={context} primary={{
    label: session ? t("mobile.auth.setup.loadAction") : t("mobile.auth.welcome.start"),
    disabled: status === "loading" || (!!session && (offline || !auth)), busy: loading,
    onPress: () => { if (session) void load(); else router.replace("/welcome"); },
  }} />}>{null}</Screen>;
}

function SetupForm({ session }: { session: SessionBootstrap }) {
  const router = useRouter();
  const auth = useAuthClient();
  const { acceptBootstrap } = useSession();
  const offline = useOffline();
  const { explicitChoice } = useLocale();
  const format = useFormat();
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clock = format.twoClock(exampleStart, siteZone, viewerZone);
  const [draft, setDraft] = useState<Draft>(() => ({
    name: session.account.displayName ?? "", readingLocale: session.preferences.readingLocale,
    twoClock: session.preferences.twoClock || (clock.kind === "available" && clock.viewerTime !== null),
  }));
  const [status, setStatus] = useState<Status>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const command = useRef<{ operationId: string; expectedRevision: number; payload: AccountSettingsPatch } | null>(null);
  const confirmed = useRef<SessionBootstrap | null>(null);

  async function save() {
    const name = draft.name.trim();
    if (!name || saving.current || (offline && !confirmed.current)) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!confirmed.current) {
        if (!auth) { setStatus("failed"); return; }
        const submission = command.current ?? {
          operationId: uuid.v4(), expectedRevision: session.preferences.revision,
          payload: { displayName: name, readingLocale: draft.readingLocale, twoClock: draft.twoClock,
            displayZone: draft.twoClock ? viewerZone ?? null : null,
            ...(session.preferences.uiLocale === null && explicitChoice ? { uiLocale: explicitChoice } : {}) },
        };
        const result = await auth.patchSettings(submission);
        if (!result.ok) {
          if (("delivery" in result.error && result.error.delivery === "unknown") || result.error.code === "INTERNAL_ERROR"
            || (command.current && result.error.code === "UNAVAILABLE")) {
            command.current = submission;
            setStatus("checking");
          } else {
            command.current = null;
            setStatus("failed");
            if (result.error.code === "STALE_REVISION") {
              const refreshed = await auth.getSession();
              if (refreshed.ok && refreshed.data.account.id === session.account.id) {
                await acceptBootstrap(refreshed.data);
                if (refreshed.data.setup === "complete") afterAuthentication(router, refreshed.data);
              }
            }
          }
          return;
        }
        command.current = null;
        confirmed.current = result.data;
      }
      await acceptBootstrap(confirmed.current);
      afterAuthentication(router, confirmed.current);
    } catch { setStatus(confirmed.current ? "local-update" : "failed"); }
    finally { saving.current = false; setBusy(false); }
  }

  return <SetupView email={session.account.email} viewerZone={viewerZone} draft={draft} onChange={setDraft}
    busy={busy} status={offline && !confirmed.current ? "offline" : status} readOnly={!!command.current || !!confirmed.current}
    onSave={() => { void save(); }} />;
}

export function SetupView({ email, viewerZone, draft, onChange, busy, status, readOnly, onSave }: {
  email: string; viewerZone: string; draft: Draft; onChange: (draft: Draft) => void;
  busy?: boolean; status?: Status; readOnly?: boolean; onSave: () => void;
}) {
  const { locale } = useLocale();
  const format = useFormat();
  const t = useT();
  const { color, radius, space } = useBeaconTheme();
  const [showReading, setShowReading] = useState(false);
  const readingTrigger = useRef<ComponentRef<typeof View>>(null);
  const clock = format.twoClock(exampleStart, siteZone, viewerZone);
  const hasViewerZone = clock.kind === "available" && clock.viewerTime !== null;
  const mute = { color: color.muted };
  const disableEditing = busy || readOnly;
  function readingLabel(tag: string | null) {
    switch (tag) {
      case null: return t("mobile.auth.setup.originals");
      case "en": return t("mobile.auth.setup.english");
      case "es": return t("mobile.auth.setup.spanish");
      case "de": return t("mobile.auth.setup.german");
      case "ro": return t("mobile.auth.setup.romanian");
      case "ar": return t("mobile.auth.setup.arabic");
      case "pt-PT": return t("mobile.auth.setup.portuguese");
      default: return tag;
    }
  }
  const date = (zone: string) => new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: zone }).format(exampleStart);
  const window = (zone: string) => `${viewerTime(locale, exampleStart, zone)}–${viewerTime(locale, exampleEnd, zone)}`;
  const siteLine = t("mobile.auth.setup.exampleWindow", { date: date(siteZone), time: window(siteZone) });
  const viewerLine = hasViewerZone && draft.twoClock && clock.kind === "available" ? t("mobile.auth.setup.viewerWindow", {
    time: clock.viewerDateDiffers ? t("mobile.auth.setup.exampleWindow", { date: date(viewerZone), time: window(viewerZone) }) : window(viewerZone),
  }) : undefined;
  const zone = hasViewerZone ? new Intl.DateTimeFormat(locale, { timeZone: viewerZone, timeZoneName: "longGeneric" })
    .formatToParts(exampleStart).find(({ type }) => type === "timeZoneName")?.value ?? viewerZone : viewerZone;
  const context = status === "offline" ? t("mobile.auth.setup.offline")
    : !draft.name.trim() ? t("mobile.auth.setup.nameRequired") : t("mobile.auth.setup.later");

  return (
    <Screen title={t("mobile.auth.setup.title")} dock={<Dock context={context} primary={{
      label: t("shared.action.continue"), onPress: onSave, busy, disabled: status === "offline" || !draft.name.trim(),
    }} />}>
      <Copy variant="supporting" style={mute}>{t("mobile.auth.setup.signedIn", { email: `\u2066${email}\u2069` })}</Copy>
      <TextField label={t("mobile.auth.setup.name")} helper={t("mobile.auth.setup.nameHint")} value={draft.name}
        onChangeText={(name) => onChange({ ...draft, name })} maxLength={100} autoCapitalize="words" autoComplete="name" readOnly={disableEditing} />
      <View style={{ gap: space.grid[2] }}>
        <Copy variant="label">{t("mobile.auth.setup.reading")}</Copy>
        <Button ref={readingTrigger} variant="neutral" arrow="next" label={readingLabel(draft.readingLocale)}
          onPress={() => setShowReading(true)} disabled={disableEditing} />
        <Copy variant="supporting" style={mute}>{t("mobile.auth.setup.readingHint")}</Copy>
      </View>
      <Card>
        <SwitchRow label={t("mobile.auth.setup.twoClocks")} value={hasViewerZone && draft.twoClock} disabled={disableEditing || !hasViewerZone}
          description={hasViewerZone ? t("mobile.auth.setup.viewerZone", { zone }) : t("mobile.auth.setup.sameZone")}
          onValueChange={(twoClock) => onChange({ ...draft, twoClock })} />
        <Copy variant="caption" style={mute}>{t("mobile.auth.setup.example")}</Copy>
        <View style={{ padding: space.grid[3], borderRadius: radius.input, backgroundColor: color.subtle }}>
          <TwoClock siteTime={siteLine} siteZone={t("mobile.auth.setup.siteZone")} viewerLine={viewerLine} />
        </View>
      </Card>
      <Copy variant="supporting" style={mute}>{t("mobile.auth.setup.permissions")}</Copy>
      {status && status !== "offline" && <StatusBanner state="not-sent"
        label={status === "checking" ? t("mobile.auth.setup.checking")
          : status === "local-update" ? t("mobile.auth.setup.savedLocallyPending") : t("mobile.auth.setup.notSaved")} />}
      <Sheet visible={showReading} title={t("mobile.auth.setup.reading")} closeLabel={t("shared.action.close")}
        onClose={() => setShowReading(false)} returnFocusRef={readingTrigger}>
        {[null, ...readingTags].map((tag) => <ListRow key={tag ?? "original"} label={readingLabel(tag)}
          selected={tag === draft.readingLocale} onPress={() => { onChange({ ...draft, readingLocale: tag }); setShowReading(false); }} />)}
      </Sheet>
    </Screen>
  );
}
