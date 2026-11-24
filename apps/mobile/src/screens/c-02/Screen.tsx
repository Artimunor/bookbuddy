import { localeTagSchema } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useT } from "../../i18n";
import { Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useOffline } from "../s-02/flow";
import { requestDraftHref, type RequestDraft, useRequestDraft } from "./draft";

export default function DescribeScreen() {
  const router = useRouter(); const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const local = useRequestDraft(); const offline = useOffline(); const t = useT();
  const next = returnTo === "review" ? "review" : "place";
  if (!local.loaded) return <Screen title={t("mobile.request.describeTitle")}><Copy>{local.failed ? t("mobile.request.saveFailed") : t("mobile.request.loading")}</Copy></Screen>;
  if (local.value.pendingOperation) return <Screen title={t("mobile.request.describeTitle")}><Copy>{t("mobile.request.checking")}</Copy><Button label={t("mobile.request.review")} onPress={() => router.replace(requestDraftHref("review", local.draftId))} /></Screen>;
  return <DescribeView draft={local.value} saved={local.saved} failed={local.failed} warn={local.warn} offline={offline} onChange={(draft) => { void local.change(draft).catch(() => {}); }} onBack={() => router.back()} onContinue={() => { void local.change({ ...local.value, step: next }).then(() => router.push(requestDraftHref(next, local.draftId))).catch(() => {}); }} />;
}

export function DescribeView({ draft, saved, failed, warn = false, offline, onChange, onBack, onContinue }: { draft: RequestDraft; saved: boolean; failed: boolean; warn?: boolean; offline: boolean; onChange: (draft: RequestDraft) => void; onBack: () => void; onContinue: () => void }) {
  const t = useT(); const valid = !!draft.description.trim() && (!draft.language.trim() || localeTagSchema.safeParse(draft.language.trim()).success);
  const reason = valid ? t("mobile.request.nextPlace") : t("mobile.request.describeRequired");
  return <Screen title={t("mobile.request.describeTitle")} navigation={{ kind: "back", label: t("mobile.request.back"), onPress: onBack }} dock={<Dock context={reason} primary={{ label: t("mobile.request.continue"), onPress: onContinue, disabled: !valid }} />}>
    <Copy variant="supporting">{t("mobile.request.stepOne")}</Copy><Copy>{t("mobile.request.languageLine")}</Copy>
    {warn && <Copy>{t("mobile.request.expiryWarning")}</Copy>}
    <Card><TextField label={t("mobile.request.description")} multiline maxLength={16000} placeholder={t("mobile.request.example")} value={draft.description} onChangeText={description => onChange({ ...draft, description })} />
    <TextField label={t("mobile.request.language")} helper={t("mobile.request.languageHelp")} value={draft.language} autoCapitalize="none" maxLength={255} onChangeText={language => onChange({ ...draft, language })} /></Card>
    {saved && <Copy variant="supporting">{offline ? t("mobile.request.savedOffline") : t("mobile.request.saved")}</Copy>}{failed && <Copy>{t("mobile.request.saveFailed")}</Copy>}
    <Copy variant="supporting">{t("mobile.request.noCodes")}</Copy>
  </Screen>;
}
