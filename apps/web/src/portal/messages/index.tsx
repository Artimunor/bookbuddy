import { appendThreadEntriesRoute, getThreadEntriesRoute, listThreadsRoute, markThreadReadRoute, type ChatEntryProjection, type ThreadEntriesPage, type ThreadSummary } from "@bookbuddy/api-contract";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { Badge, Button, Card, Dock, Glyph, Stamp, TextField, TwinBubble, type TwinContent } from "../../ui";
import { jobTitle, Frame, momentLabel, PortalClock, usePortalViewerZone } from "../now/common";
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
  return <Frame current="messages"><h1 className="text-page-title">{t("web.portal.closeout.messages")}</h1>
    <TextField label={t("web.portal.closeout.search")} value={search} onChange={event => setSearch(event.target.value)} />
    {!threads && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
    {threads && !shown?.length && <Card>{t("web.portal.closeout.emptyMessages")}</Card>}
    {shown && shown.length > 0 && <ul className="space-y-3">{shown.map(thread => <li key={thread.id}>
      <Link className="bb-card bb-booking-card" to={`/portal/messages/${encodeURIComponent(thread.id)}`}>
        <div className="bb-card-heading"><div><h2 className="text-label" dir="auto">{thread.contact?.displayName ?? (thread.job.title ? jobTitle(t,thread.job.title,thread.job.reference) : t("web.portal.closeout.jobChat"))}</h2>
          <p className="text-supporting text-muted">{t("web.portal.closeout.jobChat")} · <bdi>{thread.job.reference}</bdi></p></div><Glyph name="chevron" /></div>
        {thread.latest && <>
          <p dir="auto">{thread.latest.preferredTranslation?.state === "ready" ? thread.latest.preferredTranslation.text : thread.latest.originalText ?? t("web.portal.closeout.attachment")}</p>
          <p className="text-supporting text-muted">{time(thread.latest.receivedAt, thread.job.siteZone)}</p>
          {thread.latest.preferredTranslation?.state === "ready" && <p className="text-supporting text-muted">{t("web.portal.closeout.translation", { language:thread.latest.preferredTranslation.targetLocale })}</p>}
          {thread.latest.preferredTranslation?.state === "pending" && <p className="text-supporting text-muted">{t("web.portal.closeout.pendingTranslation")}</p>}
          {thread.latest.preferredTranslation?.state === "unavailable" && <p className="text-supporting text-muted">{t("web.portal.closeout.unavailableTranslation")}</p>}
        </>}
        {thread.unreadCount > 0 && <div><Badge tone="info" label={t("web.portal.closeout.unread", { count:thread.unreadCount })} /></div>}
      </Link>
    </li>)}</ul>}
    {cursor && <Button variant="secondary" disabled={loading} onClick={() => void more()}>{t("web.portal.closeout.more")}</Button>}
  </Frame>;
}
export function Thread() { const { id = "" } = useParams(); const scope = useScopeKey(); return <ThreadPage key={`${scope}:${id}`} id={id} />; }
function ThreadPage({ id }: { id: string }) {
  const { api, t, locale } = useCloseout(); const [page, setPage] = useState<ThreadEntriesPage | null>(null); const [error, setError] = useState(false); const [generation, setGeneration] = useState(0); const [draft, setDraft] = useState(""); const [sent, setSent] = useState<{ id: string; text: string; at: number }[]>([]); const [loading, setLoading] = useState(false);
  const viewerZone = usePortalViewerZone();
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
  const command = usePendingOperation(`thread-send:${id}`, async (op: MessageOperation) => {
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
  return <Frame current="messages"><Link to="/portal/messages">{t("web.portal.closeout.messages")}</Link>
    <header className="space-y-1">
      <h1 className="text-page-title">{t("web.portal.closeout.jobChat")}</h1>
      {details && <p className="text-supporting text-muted" dir="auto">{[details.job.reference,jobTitle(t,details.job.title,details.job.reference)].filter(Boolean).join(" · ")}</p>}
    </header>
    <CommandState status={command.state} check={command.check} />
    {!details && (error ? <><p role="alert">{t("web.portal.closeout.unavailable")}</p><Button onClick={() => setGeneration(n => n + 1)}>{t("web.portal.closeout.retry")}</Button></> : <p role="status">{t("web.portal.closeout.loading")}</p>)}
    {details && <>
      {page && !rows.length && !sent.length && <Card>{t("web.portal.closeout.emptyThread")}</Card>}
      <div aria-live="polite" className="space-y-4">
        {rows.map(row => {
          const time = <PortalClock at={row.at} zone={details.job.siteZone} locale={locale} viewerZone={viewerZone} />;
          if ("entry" in row && row.entry) return <Message key={row.entry.id} entry={row.entry} time={time} />;
          if (!("stamp" in row) || !row.stamp) return null;
          const { update } = row.stamp;
          return <Card key={update.id}><div className="bb-moments"><Stamp kind="crew" title={momentLabel(t,update.kind)} time={time}
            actor={"sharedByName" in update ? {name:update.sharedByName,role:""} : undefined} /></div></Card>;
        })}
        {sent.filter(item => !page?.entries.some(entry => entry.id === item.id)).map(item => <TwinBubble key={item.id} outgoing
          original={{text:item.text}} reading={{state:"original"}} author={{name:t("web.portal.closeout.sent")}}
          time={<PortalClock at={item.at} zone={details.job.siteZone} locale={locale} viewerZone={viewerZone} />} />)}
      </div>
      {page?.page.cursor && <Button variant="secondary" disabled={loading} onClick={() => void more()}>{t("web.portal.closeout.more")}</Button>}
      {details.canSend ? <>
        <Card><div className="space-y-2">
          <label className="bb-field"><span className="text-label">{t("web.portal.closeout.compose")}</span><textarea className="bb-input" dir="auto" rows={3} maxLength={16000} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} /></label>
          <p className="text-supporting text-muted">{t("web.portal.closeout.writeHint")}</p>
        </div></Card>
        <Dock context={t("web.portal.closeout.offline")} primary={{ label:t("web.portal.closeout.send"), disabled:!draft.trim() || busy, onClick:send }} />
      </> : <Card>{t("web.portal.closeout.readOnly")}</Card>}
    </>}
  </Frame>;
}
function Message({ entry, time }: { entry: ChatEntryProjection; time: ReactNode }) {
  const { t } = useCloseout();
  const translation = entry.preferredTranslation;
  const original = { text:entry.originalText ?? t("web.portal.closeout.attachment"), lang:entry.sourceLanguage ?? undefined };
  let reading: TwinContent["reading"] = {state:"original"};
  if (translation?.state === "ready") reading = {
    state:"translated", passage:{text:translation.text,lang:translation.targetLocale},
    originalLabel:entry.sourceLanguage ? t("web.portal.closeout.original",{language:entry.sourceLanguage}) : t("web.portal.auth.original"),
    translationLabel:t("web.portal.closeout.translation",{language:translation.targetLocale}),
  };
  else if (translation?.state === "pending") reading = {state:"pending",label:t("web.portal.closeout.pendingTranslation")};
  else if (translation?.state === "unavailable") reading = {state:"unavailable",label:t("web.portal.closeout.unavailableTranslation")};
  return <div className="space-y-2">
    <TwinBubble original={original} reading={reading} author={{name:entry.author.displayName}} time={time} outgoing={entry.author.isViewer} />
    {entry.attachments.length > 0 && <AttachmentThumb caller="chat" parentScopeId={entry.id} attachments={entry.attachments.map(item => ({
      attachmentId:item.attachmentId, available:item.availability === "available", photo:item.kind === "photo",
    }))} />}
    {entry.author.isViewer && <p className="text-end text-supporting text-muted">{t("web.portal.closeout.sent")}</p>}
  </div>;
}
