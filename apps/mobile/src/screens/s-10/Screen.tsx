import { appendThreadEntriesRoute, getThreadEntriesRoute, getThreadRoute, markThreadReadRoute, reportTranslationRoute, requestTranslationRoute, type ChatEntryProjection, type ThreadDetails, type ThreadEntriesPage } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useLiveHints } from "../../api/live";
import { useApiAccess } from "../../api/provider";
import { useLocale, useT } from "../../i18n";
import { useOutbox, useRepository } from "../../repository/hooks";
import { Button, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { Stamp } from "../../ui/live/Stamp";
import { TwinBubble } from "../../ui/live/TwinBubble";
import { readingLanguageLabel } from "../s-12/language";
import { roleLabel } from "../s-06/account";
import { useBeaconTheme } from "../../ui/theme";

type PendingMessage = { id: string; text: string; sourceLanguage: string; at: number; failed?: boolean };
export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>(); const id = threadId ?? ""; const router = useRouter();
  const details = useRemote(getThreadRoute, { params: { id } }, { enabled: !!id, loadOnMount: false });
  const page = useRemote(getThreadEntriesRoute, { params: { id } }, { enabled: !!id, loadOnMount: false });
  const { client, offline } = useApiAccess(); const outbox = useOutbox(); const repo = useRepository();
  const read = useCommand(markThreadReadRoute); const report = useCommand(reportTranslationRoute); const translate = useCommand(requestTranslationRoute);
  const [draft, setDraft] = useState(""); const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false); const [reported, setReported] = useState(false);
  const [history, setHistory] = useState<{ id: string; repo: typeof repo; entries: ChatEntryProjection[]; cursor: string | null }>({ id, repo, entries: [], cursor: null });
  const attempt = useRef<{ id: string; text: string; sourceLanguage: string } | null>(null);
  const previous = useRef<{ id: string; repo: typeof repo; details: ThreadDetails | null; page: ThreadEntriesPage | null }>({ id, repo, details: null, page: null });
  const refreshThread = () => { void details.refresh(); void page.refresh(); };
  const retryLive = useLiveHints(id ? { kind: "thread", opaqueId: id } : null, page.refresh, {
    onCatchUp: ({ at, details: thread, page: firstPage }) => { details.seed(thread, at); page.seed(firstPage, at); },
    onUnavailable: refreshThread,
    onScopeClosed: () => {
      previous.current = { id, repo, details: null, page: null };
      setHistory({ id, repo, entries: [], cursor: null });
      refreshThread();
    },
  });
  if (previous.current.id !== id || previous.current.repo !== repo) previous.current = { id, repo, details: null, page: null };
  if (details.status === "ready") previous.current.details = details.data;
  if (page.status === "ready") previous.current.page = page.data;
  const denied = details.status === "error" || page.status === "error";
  if (denied) previous.current = { id, repo, details: null, page: null };
  useEffect(() => {
    const error = details.status === "error" ? details.error : page.status === "error" ? page.error : null;
    if (error?.code === "NOT_FOUND" || error?.code === "UNAUTHENTICATED") router.replace("/help" as Href);
  }, [details.status, details.error, page.status, page.error, router]);
  const data = repo?.isActive && !denied ? details.data ?? (offline ? previous.current.details : null) : null;
  const currentPage = repo?.isActive && !denied ? page.data ?? (offline ? previous.current.page : null) : null;
  const older = history.id === id && history.repo === repo ? history.entries : [];
  const cursor = history.id === id && history.repo === repo && history.entries.length ? history.cursor : undefined;
  const entries = currentPage && { ...currentPage, entries: [...currentPage.entries, ...older.filter(old => !currentPage.entries.some(entry => entry.id === old.id))], page: cursor === undefined ? currentPage.page : { cursor, hasMore: cursor !== null } } as ThreadEntriesPage;
  const lastMarked = useRef(0);
  useEffect(() => { setDraft(""); attempt.current = null; lastMarked.current = 0; }, [id, repo]);
  const position = entries?.entries.reduce((max, entry) => Math.max(max, entry.position), 0) ?? 0;
  useEffect(() => { if (!offline && data && position > Math.max(data.readPosition, lastMarked.current)) { lastMarked.current = position; void read.run({ params: { id }, body: { payload: { position } } }); } }, [id, data, position, offline]);
  const pending: PendingMessage[] = outbox.entries.flatMap(entry => entry.operation.kind === "chat_append" && entry.operation.payload.threadId === id && entry.operation.payload.originalText ? [{ id: entry.operation.payload.id, text: entry.operation.payload.originalText, sourceLanguage: entry.operation.payload.sourceLanguage, at: entry.createdAt, failed: entry.status === "rejected" }] : []);
  async function send() {
    const text = draft; if (!text.trim() || !data?.canSend || busy) return;
    const sourceLanguage = data.members.find(member => member.isViewer)?.writingLanguage ?? data.readingLocale ?? "en";
    const prior = attempt.current;
    const messageId = prior && prior.text === text && prior.sourceLanguage === sourceLanguage ? prior.id : uuid.v4();
    attempt.current = { id: messageId, text, sourceLanguage }; setBusy(true); setFailed(false);
    try {
      if (offline) { await outbox.enqueueOperation({ kind: "chat_append", operationId: messageId, payload: { id: messageId, threadId: id, sourceLanguage, originalText: text } }); setDraft(""); attempt.current = null; }
      else if (client) {
        const result = await client.request(appendThreadEntriesRoute, { params: { id }, body: { operations: [{ operationId: messageId, payload: { id: messageId, sourceLanguage, originalText: text } }] } });
        if (result.ok && result.data.outcomes[0] && result.data.outcomes[0].status !== "rejected") { setDraft(""); attempt.current = null; await page.refresh(); }
        else setFailed(true);
      } else setFailed(true);
    } catch { setFailed(true); } finally { setBusy(false); }
  }
  async function loadMore() {
    if (!client || !entries?.page.cursor || offline || busy) return;
    setBusy(true);
    try {
      const result = await client.request(getThreadEntriesRoute, { params: { id }, query: { cursor: entries.page.cursor } });
      if (result.ok && result.data.threadId === id && previous.current.id === id && previous.current.repo === repo && repo?.isActive) setHistory(previous => ({ id, repo, entries: [...(previous.id === id && previous.repo === repo ? previous.entries : []), ...result.data.entries], cursor: result.data.page.cursor }));
    } finally { setBusy(false); }
  }
  return <ChatView data={data} page={entries} pending={pending} offline={offline} draft={draft} busy={busy} failed={failed} reported={reported} onDraft={setDraft} onSend={() => { void send(); }} onMore={() => { void loadMore(); }} onBack={() => router.canGoBack() ? router.back() : router.replace("/c/messages" as Href)} onDetails={() => router.push(`/threads/${id}/details` as Href)} onRetry={() => { if (!retryLive()) refreshThread(); }} onReport={entry => { const locale = entry.preferredTranslation?.targetLocale; if (locale) void report.run({ params: { id: entry.id }, body: { payload: { targetLocale: locale } } }).then(result => setReported(result.ok)); }} onTranslate={entry => { const locale = entry.preferredTranslation?.targetLocale; if (locale) void translate.run({ params: { id: entry.id }, body: { payload: { targetLocale: locale } } }).then(result => { if (result.ok) void page.refresh(); }); }} />;
}

type ChatViewProps = { data: ThreadDetails | null; page: ThreadEntriesPage | null; pending: PendingMessage[]; offline: boolean; draft: string; busy: boolean; failed: boolean; reported: boolean; onDraft: (value: string) => void; onSend: () => void; onMore: () => void; onBack: () => void; onDetails: () => void; onRetry: () => void; onReport: (entry: ChatEntryProjection) => void; onTranslate: (entry: ChatEntryProjection) => void };
export function ChatView({ data, page, pending, offline, draft, busy, failed, reported, onDraft, onSend, onMore, onBack, onDetails, onRetry, onReport, onTranslate }: ChatViewProps) {
  const t = useT(); const { locale } = useLocale(); const { color, space, radius } = useBeaconTheme();
  const [selected, setSelected] = useState<string | null>(null);
  const time = (at: number) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", timeZone: data?.job.siteZone ?? "UTC" }).format(at);
  const contact = data?.members.find(member => member.isContact) ?? data?.members.find(member => !member.isViewer);
  const items = page ? [...page.entries.map(entry => ({ at: entry.receivedAt, entry })), ...page.stamps.map(stamp => ({ at: "update" in stamp ? stamp.update.recordedAt : stamp.at, stamp }))].sort((a, b) => a.at - b.at) : [];
  const composer = data && (data.canSend ? <View style={{ padding: space.contentInset, gap: space.grid[2], backgroundColor: color.surface }}>
    <Copy variant="supporting">{data.audience === "crew" ? t("mobile.chat.crewHint") : t("mobile.chat.writeHint")}</Copy>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.grid[2] }}>
      <TextInput accessibilityLabel={t("mobile.chat.compose")} placeholder={t("mobile.chat.compose")} placeholderTextColor={color.muted} multiline maxLength={16000} value={draft} onChangeText={onDraft} style={{ flex: 1, minHeight: 56, maxHeight: 120, borderWidth: 1, borderColor: color.outline, borderRadius: radius.card, paddingHorizontal: space.grid[4], color: color.ink }} />
      <Button label={t("mobile.chat.send")} disabled={!draft.trim() || busy} busy={busy} onPress={onSend} />
    </View>{failed && <Copy>{t("mobile.chat.failed")}</Copy>}</View> : <View style={{ padding: space.contentInset }}><Copy>{data.readOnlyReason === "job_closed" ? t("mobile.chat.closed") : t("mobile.chat.readOnly")}</Copy></View>);
  return <Screen title={data?.audience === "crew" ? t("mobile.chat.crew") : t("mobile.chat.job")} navigation={{ kind: "back", label: t("mobile.chat.back"), onPress: onBack }} dock={composer} bell={<Button variant="navigation" label={t("mobile.chat.details")} glyph="ⓘ" iconOnly onPress={onDetails} />}>
    {data && <><Copy variant="supporting">{data.job.reference} · {data.job.title}</Copy><Pressable accessibilityRole="button" onPress={onDetails} style={{ backgroundColor: color.subtle, padding: space.grid[3], borderRadius: radius.card }}><Copy variant="supporting">{t("mobile.chat.languageLine", { reading: readingLanguageLabel(t, data.readingLocale), name: contact?.displayName ?? "", writing: readingLanguageLabel(t, contact?.writingLanguage ?? null) })}</Copy></Pressable></>}
    {offline && <Copy>{t("mobile.chat.offline")}</Copy>}
    {!data && <><Copy>{offline ? t("mobile.chat.offline") : t("mobile.chat.loading")}</Copy><Button variant="neutral" label={t("mobile.chat.retry")} onPress={onRetry} /></>}
    {page?.page.hasMore && <Button variant="quiet" label={t("mobile.chat.more")} disabled={busy || offline} onPress={onMore} />}
    {page && items.length === 0 && pending.length === 0 && <Copy>{t("mobile.chat.emptyThread")}</Copy>}
    {items.map(item => {
      if ("stamp" in item && item.stamp) {
        const stamp = item.stamp; const kind = "update" in stamp ? stamp.update.kind : stamp.kind;
        const title = kind === "crew_confirmed" ? t("mobile.chat.eventCrewConfirmed") : kind === "crew_updated" ? t("mobile.chat.eventCrewUpdated") : kind === "on_the_way" ? t("mobile.chat.eventOnWay") : kind === "arrival_revised" ? t("mobile.chat.eventArrivalRevised") : kind === "arrival_withdrawn" ? t("mobile.chat.eventArrivalWithdrawn") : kind === "on_site" ? t("mobile.chat.eventOnSite") : kind === "cover_arranging" ? t("mobile.chat.eventCover") : kind === "paused" || kind === "work_paused" ? t("mobile.chat.eventPaused") : kind === "photo" ? t("mobile.chat.eventPhoto") : kind === "working" || kind === "work_started" ? t("mobile.chat.eventWorking") : kind === "finished" || kind === "work_finished" ? t("mobile.chat.eventFinished") : kind === "cover_confirmed" ? t("mobile.chat.eventCoverConfirmed") : kind === "checked_in" ? t("mobile.chat.eventCheckIn") : t("mobile.chat.eventCheckOut");
        const update = "update" in stamp ? stamp.update : null;
        const detail = update && "band" in update ? `${time(update.band.startsAt)} – ${time(update.band.endsAt)}` : undefined;
        return <Stamp key={update ? update.id : ("id" in stamp ? stamp.id : "")} kind="system" title={title} detail={detail} time={time(item.at)} />;
      }
      if (!("entry" in item) || !item.entry) return null;
      const entry = item.entry; const tr = entry.preferredTranslation;
      const translation = tr?.state === "ready" ? { state: "translated" as const, text: tr.text, label: t("mobile.chat.translation", { language: readingLanguageLabel(t, tr.targetLocale) }), originalLabel: t("mobile.chat.original", { language: readingLanguageLabel(t, entry.sourceLanguage) }), languageTag: tr.targetLocale } : tr?.state === "pending" ? { state: "pending" as const, label: t("mobile.chat.translating") } : tr?.state === "unavailable" ? { state: "unavailable" as const, label: t("mobile.chat.translationUnavailable") } : { state: "sameLanguage" as const };
      return <View key={entry.id} style={{ gap: 4 }}><Pressable accessibilityRole="button" onPress={() => setSelected(selected === entry.id ? null : entry.id)}><TwinBubble side={entry.author.isViewer ? "outgoing" : "incoming"} attribution={`${entry.author.displayName} · ${roleLabel(t, entry.author.role)}`} time={time(entry.receivedAt)} original={{ text: entry.originalText ?? t("mobile.chat.attachment"), dir: /^(ar|he|fa|ur)(-|$)/i.test(entry.sourceLanguage ?? "") ? "rtl" : "ltr", languageTag: entry.sourceLanguage ?? undefined }} translation={translation} delivery={entry.author.isViewer ? { state: "received", label: entry.readingLocales?.length ? t("mobile.chat.sentReads", { languages: entry.readingLocales.map(tag => readingLanguageLabel(t, tag)).join(", ") }) : t("mobile.chat.sent") } : undefined} /></Pressable>
        {selected === entry.id && tr?.state === "ready" && <Button variant="quiet" label={t("mobile.chat.report")} onPress={() => onReport(entry)} />}
        {tr?.state === "unavailable" && tr.canRetry && <Button variant="quiet" label={t("mobile.chat.retry")} onPress={() => onTranslate(entry)} />}
        {tr?.state === "unavailable" && <Button variant="quiet" label={t("mobile.chat.clarify")} onPress={() => onDraft(t("mobile.chat.clarification"))} />}
      </View>;
    })}
    {pending.map(message => <TwinBubble key={message.id} side="outgoing" attribution={t("mobile.chat.you")} time={time(message.at)} original={{ text: message.text, dir: /^(ar|he|fa|ur)(-|$)/i.test(message.sourceLanguage) ? "rtl" : "ltr", languageTag: message.sourceLanguage }} translation={{ state: "sameLanguage" }} delivery={{ state: message.failed ? "failed" : "queued", label: message.failed ? t("mobile.chat.failed") : `${t("mobile.chat.queued")} · ${t("mobile.chat.notReceived")}` }} />)}
    {reported && <Copy>{t("mobile.chat.reported")}</Copy>}
  </Screen>;
}
