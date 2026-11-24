import { appendThreadEntriesRoute, getThreadEntriesRoute, listThreadsRoute, markThreadReadRoute, type ChatEntryProjection, type ThreadEntriesPage, type ThreadSummary } from "@bookbuddy/api-contract";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge, Button, Card, TextField } from "../../ui";
import { Frame, momentLabel } from "../now/common";
import { CommandState, useCloseout, useScopeKey } from "../completion/common";
import { AttachmentThumb } from "../media";
import { usePendingOperation } from "../session/pending-operation";

type MessageOperation = { operationId: string; payload: { id: string; sourceLanguage: string; originalText: string } };
export function Messages() { const scope = useScopeKey(); return <MessagesPage key={scope} />; }
function MessagesPage() {
  const { api, t, time } = useCloseout(); const [threads, setThreads] = useState<Extract<ThreadSummary, { audience: "job" }>[] | null>(null); const [cursor, setCursor] = useState<string | null>(null); const [search, setSearch] = useState(""); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [loading, setLoading] = useState(false);
  useEffect(() => { const controller = new AbortController(); setThreads(null); setError(false); void api.request(listThreadsRoute, {}, { signal: controller.signal }).then(result => { if (controller.signal.aborted) return; if (result.ok) { setThreads(result.data.threads.filter(thread => thread.audience === "job")); setCursor(result.data.page.cursor); } else setError(true); }); return () => controller.abort(); }, [api, generation]);
  async function more() { if (!cursor || loading) return; setLoading(true); const result = await api.request(listThreadsRoute, { query: { cursor } }); if (result.ok) { setThreads(items => [...(items ?? []), ...result.data.threads.filter(thread => thread.audience === "job")]); setCursor(result.data.page.cursor); } else setError(true); setLoading(false); }
  const shown = threads?.filter(item => `${item.contact?.displayName ?? ""} ${item.job.reference} ${item.job.title ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <Frame><h1 className="text-display">{t("web.portal.closeout.messages")}</h1><TextField label={t("web.portal.closeout.search")} value={search} onChange={event => setSearch(event.target.value)} />{!threads && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}{threads && !shown?.length && <p>{t("web.portal.closeout.emptyMessages")}</p>}<ul className="space-y-4">{shown?.map(thread => <li key={thread.id}><Card><Link to={`/portal/messages/${encodeURIComponent(thread.id)}`}><strong dir="auto">{thread.contact?.displayName ?? thread.job.title}</strong><p>{t("web.portal.closeout.jobChat")} · <bdi>{thread.job.reference}</bdi></p>{thread.latest && <><p dir="auto">{thread.latest.preferredTranslation?.state === "ready" ? thread.latest.preferredTranslation.text : thread.latest.originalText ?? t("web.portal.closeout.attachment")}</p><p>{time(thread.latest.receivedAt, thread.job.siteZone)}</p>{thread.latest.preferredTranslation?.state === "ready" && <p>{t("web.portal.closeout.translation", { language: thread.latest.preferredTranslation.targetLocale })}</p>}{thread.latest.preferredTranslation?.state === "pending" && <p>{t("web.portal.closeout.pendingTranslation")}</p>}{thread.latest.preferredTranslation?.state === "unavailable" && <p>{t("web.portal.closeout.unavailableTranslation")}</p>}</>}{thread.unreadCount > 0 && <Badge label={t("web.portal.closeout.unread", { count: thread.unreadCount })} />}</Link></Card></li>)}</ul>{cursor && <Button disabled={loading} onClick={() => void more()}>{t("web.portal.closeout.more")}</Button>}</Frame>;
}
export function Thread() { const { id = "" } = useParams(); const scope = useScopeKey(); return <ThreadPage key={`${scope}:${id}`} id={id} />; }
function ThreadPage({ id }: { id: string }) {
  const { api, t, locale, time } = useCloseout(); const [page, setPage] = useState<ThreadEntriesPage | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [draft, setDraft] = useState(""); const [sent, setSent] = useState<{ id: string; text: string; at: number }[]>([]); const [loading, setLoading] = useState(false);
  const details = page?.thread?.audience === "job" ? page.thread : null;
  useEffect(() => {
    const controller = new AbortController();
    setError(false); setPage(null);
    void api.request(getThreadEntriesRoute, { params: { id } }, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (!result.ok || result.data.thread?.audience !== "job") { setError(true); return; }
      setPage(result.data);
      const position = result.data.entries.reduce((max, entry) => Math.max(max, entry.position), 0);
      if (position > result.data.thread.readPosition) void api.request(markThreadReadRoute, { params: { id },
        body: { operationId: crypto.randomUUID(), payload: { position } } });
    });
    return () => controller.abort();
  }, [api, id, generation]);
  const command = usePendingOperation(`thread-send:${id}`, `POST ${appendThreadEntriesRoute.path}`, async (op: MessageOperation) => {
    const result = await api.request(appendThreadEntriesRoute, { params: { id }, body: { operations: [op] } });
    if (!result.ok) return result;
    const outcome = result.data.outcomes.find(item => item.operationId === op.operationId);
    if (!outcome) return { ok: false as const, error: { code: "INVALID_RESPONSE", delivery: "unknown" } };
    if (outcome.status === "rejected") return { ok: false as const, error: outcome.error };
    return { ok: true as const, data: outcome.receipt };
  }, (receipt, input) => {
    setSent(items => [...items, { id: input.payload.id, text: input.payload.originalText, at: receipt.receivedAt }]);
    setDraft("");
  }, undefined, {
    onCommitted: () => { setDraft(""); setPage(null); setGeneration(n => n + 1); },
  });
  const busy = command.state === "sending" || command.state === "checking";
  function send() { if (!draft.trim() || !details?.canSend || busy || !navigator.onLine) return; const messageId = crypto.randomUUID(); command.start({ operationId: crypto.randomUUID(), payload: { id: messageId, originalText: draft, sourceLanguage: details.members.find(member => member.isViewer)?.writingLanguage ?? locale } }); }
  async function more() { const cursor = page?.page.cursor; if (!cursor || loading) return; setLoading(true); const result = await api.request(getThreadEntriesRoute, { params: { id }, query: { cursor } }); if (result.ok && result.data.audience === "job") { const next = result.data; setPage(previous => previous?.audience === "job" ? { ...previous, page: next.page, entries: [...previous.entries, ...next.entries], stamps: [...previous.stamps, ...next.stamps] } : previous); } else setError(true); setLoading(false); }
  const rows = page?.audience === "job" ? [...page.entries.map(entry => ({ at: entry.receivedAt, entry })), ...page.stamps.map(stamp => ({ at: stamp.update.recordedAt, stamp }))].sort((a, b) => a.at - b.at) : [];
  return <Frame><Link to="/portal/messages">{t("web.portal.closeout.messages")}</Link><h1 className="text-display">{t("web.portal.closeout.jobChat")}</h1><CommandState status={command.state} check={command.check} />{!details && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}{details && <><p dir="auto">{details.job.reference} · {details.job.title}</p>{page && !rows.length && !sent.length && <p>{t("web.portal.closeout.emptyThread")}</p>}<div aria-live="polite" className="space-y-4">{rows.map(row => "entry" in row && row.entry ? <Message key={row.entry.id} entry={row.entry} time={time(row.at, details.job.siteZone)} /> : "stamp" in row && row.stamp ? <Card key={row.stamp.update.id}><p>{momentLabel(t, row.stamp.update.kind)} · {time(row.at, details.job.siteZone)}</p>{"sharedByName" in row.stamp.update && <p dir="auto">{row.stamp.update.sharedByName}</p>}</Card> : null)}{sent.filter(item => !page?.entries.some(entry => entry.id === item.id)).map(item => <Card key={item.id}><p dir="auto">{item.text}</p><p>{t("web.portal.closeout.sent")} · {time(item.at, details.job.siteZone)}</p></Card>)}</div>{page?.page.cursor && <Button disabled={loading} onClick={() => void more()}>{t("web.portal.closeout.more")}</Button>}{details.canSend ? <><p>{t("web.portal.closeout.writeHint")}</p><label className="block">{t("web.portal.closeout.compose")}<textarea className="block w-full" dir="auto" maxLength={16000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} /></label><p>{t("web.portal.closeout.offline")}</p><Button disabled={!draft.trim() || busy} onClick={send}>{t("web.portal.closeout.send")}</Button></> : <p>{t("web.portal.closeout.readOnly")}</p>}</>}</Frame>;
}
function Message({ entry, time }: { entry: ChatEntryProjection; time: string }) { const { t } = useCloseout(); const translation = entry.preferredTranslation; return <Card><p>{entry.author.displayName} · {time}</p>{translation?.state === "ready" && <><p>{t("web.portal.closeout.translation", { language: translation.targetLocale })}</p><p lang={translation.targetLocale} dir="auto">{translation.text}</p></>}{translation?.state === "pending" && <p>{t("web.portal.closeout.pendingTranslation")}</p>}{translation?.state === "unavailable" && <p>{t("web.portal.closeout.unavailableTranslation")}</p>}{entry.originalText && <><p>{t("web.portal.closeout.original", { language: entry.sourceLanguage ?? "" })}</p><p lang={entry.sourceLanguage ?? undefined} dir="auto">{entry.originalText}</p></>}<AttachmentThumb caller="chat" parentScopeId={entry.id} attachments={entry.attachments.map(item => ({ attachmentId: item.attachmentId, available: item.availability === "available", photo: item.kind === "photo" }))} />{entry.author.isViewer && <p>{t("web.portal.closeout.sent")}</p>}</Card>; }
