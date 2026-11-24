import type { AccountSettingsPatch } from "@bookbuddy/api-contract";
import { Button, Card, SegmentedControl, Select, SwitchRow } from "../../ui";
import { Frame, SignOutControl, usePortal } from "../now/common";
import { usePortalAuth } from "../session";
import { usePendingOperation } from "../session/pending-operation";
import { PendingReceiptNotice } from "../session/pending-receipt";

export function Settings() {
  const { bootstrap, acceptBootstrap, reload, t, locale } = usePortal();
  const authClient = usePortalAuth();
  const command = usePendingOperation("settings", (body: { operationId: string; expectedRevision: number; payload: AccountSettingsPatch }) => authClient.patchSettings(body), acceptBootstrap, undefined, { onCommitted: reload });
  if (!bootstrap) return null;
  const preferences = bootstrap.preferences;
  const disabled = command.state === "sending" || command.state === "checking";
  function save(payload: AccountSettingsPatch) {
    if (!bootstrap || disabled) return;
    command.start({ operationId: crypto.randomUUID(), expectedRevision: bootstrap.preferences.revision, payload });
  }
  const names = new Intl.DisplayNames([locale], { type: "language" });
  return <Frame current="settings"><h1 className="text-page-title">{t("web.portal.ps.languageDisplay")}</h1>
    <Card><SegmentedControl label={t("web.portal.ps.appLanguage")} value={locale} options={[{value:"en",label:"English"},{value:"pt-PT",label:"Português"}]} disabled={disabled} onValueChange={value=>{ if (value !== locale) void save({uiLocale:value}); }}/></Card>
    <Card><Select label={t("web.portal.auth.reading")} hint={t("web.portal.auth.originalHint")} value={preferences.readingLocale ?? ""} disabled={disabled} onChange={e=>void save({readingLocale:e.target.value || null})}>
      <option value="">{t("web.portal.auth.original")}</option>{["en","es","de","ro","ar","pt-PT"].map(tag=><option key={tag} value={tag}>{names.of(tag)}</option>)}
    </Select></Card>
    <Card>
      <SwitchRow label={t("web.portal.auth.twoClock")} checked={preferences.twoClock} disabled={disabled} onCheckedChange={twoClock=>void save({twoClock, displayZone: twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : null})}/>
      <SwitchRow label={t("web.portal.auth.shareDisplayZone")} checked={preferences.shareDisplayZone} disabled={disabled} onCheckedChange={shareDisplayZone=>void save({shareDisplayZone})}/>
      <SegmentedControl label={t("web.portal.ps.appearance")} value={preferences.theme} disabled={disabled} options={[{value:"system",label:t("web.portal.ps.system")},{value:"light",label:t("web.portal.ps.light")},{value:"dark",label:t("web.portal.ps.dark")}]} onValueChange={theme=>{ if(theme !== preferences.theme) void save({theme}); }}/>
    </Card>
    {command.state === "failed" && <p role="alert">{t("web.portal.auth.notSaved")}</p>}{command.state === "checking" && <><p role="status">{t("web.portal.auth.uncertain")}</p><Button onClick={command.check}>{t("web.portal.work.checkAgain")}</Button></>}<p>{t("web.portal.ps.unchangedTerms")}</p>
    <PendingReceiptNotice state={command.state} />
    <Card><SignOutControl /></Card>
  </Frame>;
}
