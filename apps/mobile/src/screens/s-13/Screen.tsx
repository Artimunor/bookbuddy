import { getThreadRoute, type ThreadDetails } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect } from "react";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Button, Card, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { readingLanguageLabel } from "../s-12/language";
import { roleLabel } from "../s-06/account";

export default function ChatDetailsScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>(); const router = useRouter();
  const remote = useRemote(getThreadRoute, { params: { id: threadId ?? "" } }, { enabled: !!threadId });
  useEffect(() => {
    if (remote.status === "error" && (remote.error?.code === "NOT_FOUND" || remote.error?.code === "UNAUTHENTICATED")) router.replace("/help" as Href);
  }, [remote.status, remote.error, router]);
  return <ChatDetailsView data={remote.data} onClose={() => router.back()} onLanguage={() => router.replace("/display" as Href)} onHelp={() => router.replace("/help" as Href)} />;
}

export function ChatDetailsView({ data, onClose, onLanguage, onHelp }: { data: ThreadDetails | null; onClose: () => void; onLanguage: () => void; onHelp: () => void }) {
  const t = useT();
  return <Sheet visible title={t("mobile.chat.details")} closeLabel={t("mobile.chat.close")} onClose={onClose}>
    {!data ? <Copy>{t("mobile.chat.loading")}</Copy> : <>
      <Copy variant="supporting">{data.audience === "crew" ? t("mobile.chat.crew") : t("mobile.chat.job")} · {data.job.reference}</Copy>
      <Copy>{data.audience === "crew" ? t("mobile.chat.audienceCrew") : t("mobile.chat.audienceJob")}</Copy>
      {data.members.map((member, index) => <Card key={`${member.displayName}-${index}`}>
        <Copy variant="label">{member.displayName} {member.isViewer ? `· ${t("mobile.chat.you")}` : ""}</Copy>
        <Copy variant="supporting">{roleLabel(t, member.role)}{member.isContact ? ` · ${t("mobile.chat.contact")}` : ""}</Copy>
        {member.writingLanguage && <Copy variant="supporting">{t("mobile.chat.writes", { language: readingLanguageLabel(t, member.writingLanguage) })}</Copy>}
        {member.readingLocale && <Copy variant="supporting">{t("mobile.chat.reads", { language: readingLanguageLabel(t, member.readingLocale) })}</Copy>}
      </Card>)}
      {data.audience === "job" && <Copy variant="supporting">{t("mobile.chat.crewGrant")}</Copy>}
      {!data.canSend && <Copy>{data.readOnlyReason === "job_closed" ? t("mobile.chat.closed") : t("mobile.chat.readOnly")}</Copy>}
      <Button variant="neutral" label={t("mobile.chat.readingLanguage", { language: readingLanguageLabel(t, data.readingLocale) })} onPress={onLanguage} />
      <Button variant="quiet" label={t("mobile.chat.help")} onPress={onHelp} />
    </>}
  </Sheet>;
}
