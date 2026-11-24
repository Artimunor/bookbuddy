import { listThreadsRoute, type ThreadSummary } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { useRepository } from "../../repository/hooks";
import { Badge, Button, Card, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { DirectedText } from "../../ui/live/parts";
import { useBeaconTheme } from "../../ui/theme";
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
  const t = useT();
  const format = useFormat();
  const { color, radius, space } = useBeaconTheme();
  return <Screen title={t("mobile.chat.messages")}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.chat.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.chat.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.chat.unavailable")}</Copy><Button label={t("mobile.chat.retry")} onPress={onRetry} variant="neutral" /></>}
    {status === "ready" && threads.length === 0 && <Card dense><Copy variant="supporting">{t("mobile.chat.empty")}</Copy></Card>}
    {threads.map(thread => {
      const latest = thread.latest; const translation = latest?.preferredTranslation;
      const text = translation?.state === "ready" ? translation.text : latest?.originalText;
      const lang = latest?.sourceLanguage; const renderedLanguage = translation?.state === "ready" ? translation.targetLocale : lang; const direction = renderedLanguage && /^(ar|he|fa|ur)(-|$)/i.test(renderedLanguage) ? "rtl" : "ltr";
      const heading = thread.audience === "session" ? thread.session : thread.job;
      const audienceLabel = thread.audience === "session" ? t("mobile.laterCustomer.bookingPass") : thread.audience === "crew" ? t("mobile.chat.crew") : t("mobile.chat.job");
      const title = thread.contact?.displayName ?? heading.title ?? audienceLabel;
      const subtitle = `${audienceLabel} · ${heading.reference}`;
      const clock = latest && format.siteTime(latest.receivedAt, heading.siteZone);
      const time = clock?.kind === "available" ? clock.site.time : undefined;
      const unread = thread.unreadCount > 0 ? t("mobile.chat.new", { count: thread.unreadCount }) : null;
      const provenance = !latest ? null : translation?.state === "pending" ? t("mobile.chat.translating") :
        translation?.state === "unavailable" ? t("mobile.chat.translationUnavailable") :
          translation?.state === "ready" ? t("mobile.chat.translatedFrom", { language: readingLanguageLabel(t, lang ?? null) }) :
            t("mobile.chat.asWritten", { language: readingLanguageLabel(t, lang ?? null) });
      return <Card dense key={thread.id} accessibilityLabel={[title, subtitle, time, text, unread, provenance].filter(Boolean).join(", ")} onPress={() => onOpen(thread.id)}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.grid[3] }}>
          {!!thread.contact && <View aria-hidden style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center", backgroundColor: color.personA, borderRadius: radius.pill }}>
            <Copy variant="caption">{thread.contact.displayName.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</Copy>
          </View>}
          <View style={{ flex: 1, minWidth: 0, gap: space.grid[1] }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "baseline", gap: space.grid[2] }}>
              <Copy variant="label">{title}</Copy>
              {!!time && <Copy variant="caption" style={{ color: color.muted, fontVariant: ["tabular-nums"] }}>{time}</Copy>}
            </View>
            <Copy variant="supporting" style={{ color: color.muted }}>{subtitle}</Copy>
            {text && <DirectedText dir={direction} style={{ color: color.ink }}>{text}</DirectedText>}
            {!!provenance && <Copy variant="caption" style={{ color: translation?.state === "ready" ? color.infoInk : color.muted }}>{provenance}</Copy>}
          </View>
        </View>
        {!!unread && <Badge label={unread} />}
      </Card>;
    })}
    {onMore && <Button variant="quiet" label={t("mobile.chat.more")} onPress={onMore} busy={moreBusy} />}
  </Screen>;
}
