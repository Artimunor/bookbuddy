import { listThreadsRoute, type ThreadSummary } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { Pressable } from "react-native";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import type { RemoteStatus } from "../../api/requests";
import { useLocale, useT } from "../../i18n";
import { useRepository } from "../../repository/hooks";
import { Button, Card, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { DirectedText } from "../../ui/live/parts";
import { readingLanguageLabel } from "../s-12/language";

export default function MessagesScreen() {
  const router = useRouter(); const repo = useRepository(); const { client } = useApiAccess();
  const remote = useRemote(listThreadsRoute, {});
  const memory = useRef<{ repo: typeof repo; threads: ThreadSummary[] }>({ repo, threads: [] });
  const [extra, setExtra] = useState<{ repo: typeof repo; threads: ThreadSummary[]; cursor: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  if (memory.current.repo !== repo || !repo?.isActive || remote.status === "error") memory.current = { repo, threads: [] };
  if (remote.status === "ready") memory.current.threads = remote.data.threads;
  const first = remote.data?.threads ?? (remote.status === "offline" && repo?.isActive ? memory.current.threads : []);
  const rest = repo?.isActive && remote.status !== "error" && extra?.repo === repo ? extra.threads.filter(item => !first.some(row => row.id === item.id)) : [];
  const cursor = extra?.repo === repo ? extra.cursor : remote.data?.page.cursor;
  async function more() {
    if (!client || !repo?.isActive || !cursor || busy) return;
    setBusy(true);
    try {
      const result = await client.request(listThreadsRoute, { query: { cursor } });
      if (result.ok && repo.isActive && memory.current.repo === repo) setExtra(previous => ({ repo, threads: [...(previous?.repo === repo ? previous.threads : []), ...result.data.threads], cursor: result.data.page.cursor }));
    } finally { setBusy(false); }
  }
  return <MessagesView threads={[...first, ...rest]} status={remote.status} onOpen={id => router.push(`/threads/${id}` as Href)} onRetry={() => { void remote.refresh(); }} onMore={cursor && remote.status === "ready" ? () => { void more(); } : undefined} moreBusy={busy} />;
}

export function MessagesView({ threads, status, onOpen, onRetry, onMore, moreBusy }: { threads: ThreadSummary[]; status: RemoteStatus; onOpen: (id: string) => void; onRetry: () => void; onMore?: () => void; moreBusy?: boolean }) {
  const t = useT(); const { locale } = useLocale();
  return <Screen title={t("mobile.chat.messages")}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.chat.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.chat.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.chat.unavailable")}</Copy><Button label={t("mobile.chat.retry")} onPress={onRetry} variant="neutral" /></>}
    {status === "ready" && threads.length === 0 && <Copy>{t("mobile.chat.empty")}</Copy>}
    {threads.map(thread => {
      const latest = thread.latest; const translation = latest?.preferredTranslation;
      const text = translation?.state === "ready" ? translation.text : latest?.originalText;
      const lang = latest?.sourceLanguage; const renderedLanguage = translation?.state === "ready" ? translation.targetLocale : lang; const direction = renderedLanguage && /^(ar|he|fa|ur)(-|$)/i.test(renderedLanguage) ? "rtl" : "ltr";
      const heading = thread.audience === "session" ? thread.session : thread.job;
      const audienceLabel = thread.audience === "session" ? t("mobile.laterCustomer.bookingPass") : thread.audience === "crew" ? t("mobile.chat.crew") : t("mobile.chat.job");
      return <Pressable key={thread.id} accessibilityRole="button" onPress={() => onOpen(thread.id)}><Card>
        <Copy variant="sectionTitle">{thread.contact?.displayName ?? heading.title ?? audienceLabel}</Copy>
        <Copy variant="supporting">{audienceLabel} · {heading.reference}</Copy>
        {text && <DirectedText dir={direction}>{text}</DirectedText>}
        {latest && <Copy variant="supporting">{translation?.state === "pending" ? t("mobile.chat.translating") : translation?.state === "unavailable" ? t("mobile.chat.translationUnavailable") : translation?.state === "ready" ? t("mobile.chat.translatedFrom", { language: readingLanguageLabel(t, lang ?? null) }) : t("mobile.chat.asWritten", { language: readingLanguageLabel(t, lang ?? null) })} · {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: heading.siteZone }).format(latest.receivedAt)}</Copy>}
        {thread.unreadCount > 0 && <Copy variant="label">{t("mobile.chat.new", { count: thread.unreadCount })}</Copy>}
      </Card></Pressable>;
    })}
    {onMore && <Button variant="quiet" label={t("mobile.chat.more")} onPress={onMore} busy={moreBusy} />}
  </Screen>;
}
