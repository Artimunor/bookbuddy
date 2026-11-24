import { appendCaseEventRoute, approvedScopeLineReferenceSchema, billIdSchema, caseEventIdSchema, caseIdSchema, getJobCompletionRoute, getProblemCaseRoute, idSchema, listJobCasesRoute, operationIdSchema, submitProblemCaseRoute, type CompletionProjection, type JobCasesProjection, type ProblemCaseProjection } from "@bookbuddy/api-contract";
import { PROBLEM_CASE_CATEGORIES, type ProblemCaseCategory } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import { uuid } from "expo";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useLocale, useT } from "../../i18n";
import { useAttach, useOpenMediaPreview, type MediaTransfer } from "../../media";
import { useSession } from "../../session";
import { Badge, Button, Card, Dock, Screen, SegmentedControl, StatusBanner, TextField, TwinCard } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { Stamp } from "../../ui/live";
import { useBeaconTheme } from "../../ui/theme";
import { AttachmentTiles, PhotoTile, useAttachNavigation } from "../c-02/attachments";
import { readingLanguageLabel } from "../s-12/language";
import { useOffline } from "../s-02/flow";
import { type CaseDraft, useCaseDraft } from "./draft";

type Participant = Extract<ProblemCaseProjection, { audience: "reporter" | "case_owner" }>;
type Completion = Extract<CompletionProjection, { audience: "customer" }>;
type T = Translator<"mobile">["t"];
function categoryLabel(t: T, category: ProblemCaseCategory) {
  switch (category) { case "quality": return t("mobile.case.quality"); case "damage": return t("mobile.case.damage"); case "bill": return t("mobile.case.bill"); case "timing": return t("mobile.case.timing"); case "other": return t("mobile.case.other"); }
}
function validCategory(value: string): value is ProblemCaseCategory { return PROBLEM_CASE_CATEGORIES.some(category => category === value); }
function eventLabel(t: T, kind: Participant["history"][number]["kind"]) {
  switch (kind) { case "acknowledged": return t("mobile.case.acknowledged"); case "closed": return t("mobile.case.closed"); case "resolved": return t("mobile.case.resolved"); case "reporter_update": return t("mobile.case.reporterUpdate"); case "substantive_update": return t("mobile.case.substantiveUpdate"); case "correction_requested": return t("mobile.case.correction"); }
}
function statusLabel(t: T, state: Participant["receipt"]["state"]) { return state === "closed" ? t("mobile.case.closed") : state === "resolved" ? t("mobile.case.resolved") : t("mobile.case.open"); }
function ReadState({ status, retry }: { status: RemoteStatus; retry: () => void }) {
  const t = useT();
  if (status === "idle" || status === "loading") return <Copy>{t("mobile.case.loading")}</Copy>;
  if (status === "offline") return <Copy>{t("mobile.case.offline")}</Copy>;
  if (status === "error") return <><Copy>{t("mobile.case.unavailable")}</Copy><Button label={t("mobile.case.retry")} onPress={retry} /></>;
  return null;
}
const empty = (category = "", billId = ""): CaseDraft => ({ category, item: "", billId, description: "", share: true, pending: null });

function useCaseMedia(parent: string | undefined, draft: CaseDraft, change: (next: CaseDraft) => Promise<void>) {
  const stages = draft.mediaStages ?? [];
  const transfer = useAttach(parent && stages.length ? "case" : undefined, stages.length ? parent : undefined);
  const navigation = useAttachNavigation(); const [failed, setFailed] = useState(false);
  const items = transfer.items.filter(item => item.selected && stages.includes(item.stageId) && !draft.omittedMedia?.includes(item.attachmentId));
  const photos = items.filter(item => item.file.kind === "photo").length;
  const voices = items.length - photos;
  return { items, failed, ready: photos <= 5 && voices <= 1 && (!stages.length || transfer.loaded) && items.every(item => item.state === "ready"),
    open: navigation.preview,
    add: async () => {
      if (!parent || draft.pending || (stages.length > 0 && !transfer.loaded) || (photos >= 5 && voices >= 1)) return;
      const stage = stages.at(-1) ?? uuid.v4();
      if (!stages.length) await change({ ...draft, mediaStages: [stage] });
      navigation.attach("case", parent, stage, photos >= 5 ? "voice" : voices >= 1 ? "photo" : undefined);
    },
    remove: async (item: MediaTransfer) => {
      if (draft.pending || await transfer.remove(item.attachmentId)) return;
      await change({ ...draft, omittedMedia: [...(draft.omittedMedia ?? []), item.attachmentId], mediaStages: [...stages, uuid.v4()] });
    },
    retry: transfer.retry,
    handle: (task: Promise<unknown>) => { setFailed(false); void task.catch(() => setFailed(true)); },
  };
}

export function CaseAttachments({ items, offline, locked, onAdd, onRemove, onOpen, onRetry }: { items: readonly MediaTransfer[]; offline: boolean; locked: boolean; onAdd: () => void; onRemove: (item: MediaTransfer) => void; onOpen: (id: string) => void; onRetry: (id: string) => void }) {
  const t = useT();
  return <Card dense><Copy variant="label" accessibilityRole="header">{t("mobile.photos.evidence")}</Copy>
    <AttachmentTiles items={items} offline={offline} onOpen={onOpen} onRemove={locked ? undefined : onRemove} onRetry={locked ? undefined : onRetry}
      actions={<Button glyph="+" variant="neutral" label={t("mobile.photos.addEvidence")} onPress={onAdd} disabled={locked || items.length >= 6} />} />
  </Card>;
}

type Evidence = Participant["report"]["evidence"][number];
function CaseEvidence({ item, eventId, onOpen }: { item: Evidence; eventId: string; onOpen?: (item: Evidence, eventId: string) => void }) {
  const t = useT();
  if (item.availability === "unavailable") return <Copy>{t("mobile.case.evidenceUnavailable")}</Copy>;
  const open = onOpen && (() => onOpen(item, eventId));
  return item.kind === "photo" ? <PhotoTile label={t("mobile.case.evidencePhoto")} onOpen={open} /> :
    open ? <Button variant="quiet" label={t("mobile.case.evidenceVoice")} onPress={open} /> : <Copy>{t("mobile.case.evidenceVoice")}</Copy>;
}

export function NewCaseScreen() {
  const params = useLocalSearchParams<{ jobId: string; category?: string; billId?: string; itemId?: string }>(); const router = useRouter(); const t = useT(); const { locale } = useLocale(); const offline = useOffline();
  const jobId = params.jobId ?? "";
  const local = useCaseDraft(`case:${idSchema.safeParse(jobId).success ? jobId : "invalid"}`, empty(validCategory(params.category ?? "") ? params.category : "", params.billId ?? ""));
  const cases = useRemote(listJobCasesRoute, { params: { j: jobId }, ...(validCategory(local.value.category) ? { query: { category: local.value.category } } : {}) }, { enabled: !!jobId && local.loaded });
  const completion = useRemote(getJobCompletionRoute, { params: { j: jobId } }, { enabled: !!jobId });
  const command = useCommand(submitProblemCaseRoute);
  const data = cases.status === "ready" ? cases.data : null;
  const [caseCursor, setCaseCursor] = useState<string | null>(null);
  const [moreCases, setMoreCases] = useState<JobCasesProjection["cases"]>([]);
  const [nextCases, setNextCases] = useState<string | null>(null);
  const casePage = useRemote(listJobCasesRoute, { params: { j: jobId }, query: { ...(validCategory(local.value.category) ? { category: local.value.category } : {}), ...(caseCursor ? { cursor: caseCursor } : {}) } }, { enabled: !!caseCursor && cases.status === "ready" });
  useEffect(() => { setCaseCursor(null); setMoreCases([]); setNextCases(data?.page.hasMore ? data.page.cursor : null); }, [cases.data, jobId]);
  useEffect(() => {
    if (!caseCursor || casePage.status !== "ready") return;
    const result = casePage.data;
    setMoreCases(previous => { const seen = new Set([...(data?.cases ?? []), ...previous].map(entry => entry.id)); return [...previous, ...result.cases.filter(entry => !seen.has(entry.id))]; });
    setNextCases(result.page.hasMore ? result.page.cursor : null); setCaseCursor(null);
  }, [caseCursor, casePage.status, casePage.data]);
  const scope = completion.status === "ready" && completion.data.audience === "customer" ? completion.data : null;
  const matched = scope?.submission?.items.find(item => item.id === params.itemId)?.scope;
  const draft = local.value; const selectedItem = draft.item === "none" ? "" : draft.item || (matched ? JSON.stringify(matched) : "");
  const media = useCaseMedia(data || (offline && draft.mediaStages?.length) ? jobId : undefined, draft, local.change);
  let item: ReturnType<typeof approvedScopeLineReferenceSchema.safeParse> | null = null;
  try { if (selectedItem) item = approvedScopeLineReferenceSchema.safeParse(JSON.parse(selectedItem)); } catch { /* Ignore a malformed local draft. */ }
  const busy = command.state === "sending"; const checking = !!draft.pending || command.state === "checking";
  const valid = validCategory(draft.category) && !!draft.description.trim() && draft.description.length <= 4000;
  async function send() {
    if (!data || offline || !valid || busy || !media.ready) return;
    const audience = data.newCaseAudience && draft.share ? draft.category === "bill" ? "provider_billing" : "provider_rectification" : null;
    const pending = draft.pending ?? { operationId: uuid.v4(), caseId: uuid.v4(), eventId: uuid.v4(), language: locale, audience };
    const next = { ...draft, item: selectedItem, pending };
    try { await local.change(next); } catch { return; }
    const result = await command.run({ params: { j: jobId }, body: { operationId: operationIdSchema.parse(pending.operationId), payload: { id: caseIdSchema.parse(pending.caseId), reportEventId: caseEventIdSchema.parse(pending.eventId), category: draft.category as ProblemCaseCategory, ...(item?.success ? { affectedItem: item.data } : {}), ...(draft.category === "bill" && billIdSchema.safeParse(draft.billId).success ? { billId: billIdSchema.parse(draft.billId) } : {}), description: { language: pending.language, text: draft.description }, evidence: media.items.map(attachment => attachment.attachmentId), expectedProviderAudience: pending.audience } } });
    if (result.ok) { await local.remove().catch(() => {}); router.replace(`/c/jobs/${jobId}/case/${result.data.receipt.id}` as Href); }
    else if (!("delivery" in result.error && result.error.delivery === "unknown")) await local.change({ ...next, pending: null }).catch(() => {});
  }
  if (!local.loaded) return <Screen title={t("mobile.case.title")}><Copy>{local.failed ? t("mobile.case.saveFailed") : t("mobile.case.loading")}</Copy></Screen>;
  return <DraftView draft={draft} selectedItem={selectedItem} scope={scope} existing={data ? [...data.cases, ...moreCases] : []} hasMore={!!nextCases} moreBusy={casePage.status === "loading"} onMore={() => { if (caseCursor) void casePage.refresh(); else if (nextCases) setCaseCursor(nextCases); }} provider={data?.newCaseAudience?.providerName ?? null} status={cases.status} onRetry={() => { void cases.refresh(); }} offline={offline} saved={local.saved} failed={local.failed || media.failed} sendFailed={command.state === "failed" || command.state === "conflict"} checking={checking} busy={busy} canSend={!!data && valid && !offline && media.ready} waitingMedia={!media.ready}
    attachments={<CaseAttachments items={media.items} offline={offline} locked={checking || busy || (!data && !offline) || (!data && !draft.mediaStages?.length)} onAdd={() => media.handle(media.add())} onRemove={item => media.handle(media.remove(item))} onOpen={media.open} onRetry={id => media.handle(media.retry(id))} />}
    onChange={next => { void local.change(next).catch(() => {}); }} onBack={() => router.back()} onSend={() => { void send(); }} onOpen={id => router.push(`/c/jobs/${jobId}/case/${id}` as Href)} />;
}

type DraftProps = { draft: CaseDraft; selectedItem: string; scope: Completion | null; existing: { id: string; reference: string }[]; hasMore?: boolean; moreBusy?: boolean; onMore?: () => void; provider: string | null; status: RemoteStatus; onRetry: () => void; offline: boolean; saved: boolean; failed: boolean; sendFailed: boolean; checking: boolean; busy: boolean; canSend: boolean; waitingMedia?: boolean; attachments?: ReactNode; onChange: (draft: CaseDraft) => void; onBack: () => void; onSend: () => void; onOpen: (id: string) => void };
export function DraftView({ draft, selectedItem, scope, existing, hasMore = false, moreBusy = false, onMore, provider, status, onRetry, offline, saved, failed, sendFailed, checking, busy, canSend, waitingMedia, attachments, onChange, onBack, onSend, onOpen }: DraftProps) {
  const t = useT(); const locked = checking || busy;
  return <Screen title={t("mobile.case.title")} subtitle={scope ? `${scope.job.reference} · ${scope.job.title ?? scope.job.placeAlias}` : undefined}
    navigation={{ kind: "back", label: t("mobile.case.back"), onPress: onBack }}
    dock={<Dock context={checking ? t("mobile.case.checking") : offline ? t("mobile.case.offline") : waitingMedia ? t("mobile.photos.wait") : !canSend ? t("mobile.case.required") : undefined} primary={{ label: checking ? t("mobile.case.checkAgain") : t("mobile.case.send"), onPress: onSend, disabled: !canSend || busy, busy }} />}>
    {status !== "ready" && !offline && <ReadState status={status} retry={onRetry} />}
    <SegmentedControl label={t("mobile.case.category")} value={draft.category} options={PROBLEM_CASE_CATEGORIES.map(value => ({ value, label: categoryLabel(t, value) }))} disabled={locked} onChange={category => onChange({ ...draft, category })} />
    {scope && <SegmentedControl label={t("mobile.case.item")} value={selectedItem} options={[{ value: "", label: t("mobile.case.noItem") }, ...scope.approvedScope.lines.map(line => ({ value: JSON.stringify(line.ref), label: line.label.reading?.status === "ready" ? line.label.reading.text : line.label.original.text }))]} disabled={locked} onChange={item => onChange({ ...draft, item: item || "none" })} />}
    <TextField label={t("mobile.case.description")} value={draft.description} maxLength={4000} multiline disabled={locked} onChangeText={description => onChange({ ...draft, description })} />
    {attachments}
    {status === "ready" && <>
      <StatusBanner state="last-confirmed" label={provider && draft.share ? t("mobile.case.who", { provider }) : t("mobile.case.bookbuddyOnly")} />
      {provider && <SegmentedControl label={draft.share ? t("mobile.case.who", { provider }) : t("mobile.case.bookbuddyOnly")} hideLabel value={draft.share ? "yes" : "no"}
        options={[{ value: "yes", label: t("mobile.case.share") }, { value: "no", label: t("mobile.case.private") }]} disabled={locked}
        onChange={value => onChange({ ...draft, share: value === "yes" })} />}
    </>}
    {saved && <Copy variant="supporting">{offline ? t("mobile.case.offline") : t("mobile.case.saved")}</Copy>}
    {failed && <StatusBanner state="not-sent" label={t("mobile.case.saveFailed")} />}
    {sendFailed && <StatusBanner state="not-sent" label={t("mobile.case.failed")} />}
    {!!existing.length && <><Copy variant="sectionTitle">{t("mobile.case.existing")}</Copy>{existing.map(item => <Button key={item.id} variant="quiet" label={item.reference} onPress={() => onOpen(item.id)} />)}</>}
    {status === "ready" && hasMore && <Button variant="quiet" label={t("mobile.case.moreCases")} onPress={onMore ?? onRetry} disabled={moreBusy} busy={moreBusy} />}
  </Screen>;
}

export function CaseScreen() {
  const { jobId, caseId } = useLocalSearchParams<{ jobId: string; caseId: string }>(); const router = useRouter(); const { locale } = useLocale(); const offline = useOffline(); const { preferences } = useSession();
  const remote = useRemote(getProblemCaseRoute, { params: { id: caseId ?? "" } }, { enabled: !!caseId }); const command = useCommand(appendCaseEventRoute); const [editing, setEditing] = useState(false);
  const local = useCaseDraft(`case-message:${idSchema.safeParse(caseId).success ? caseId : "invalid"}`, empty());
  const data = remote.status === "ready" && (remote.data.audience === "reporter" || remote.data.audience === "case_owner") && remote.data.job.jobId === jobId ? remote.data : null;
  const media = useCaseMedia(data?.receipt.id, local.value, local.change);
  const open = useOpenMediaPreview();
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [moreHistory, setMoreHistory] = useState<Participant["history"]>([]);
  const [nextHistory, setNextHistory] = useState<string | null>(null);
  const historyPage = useRemote(getProblemCaseRoute, { params: { id: caseId ?? "" }, query: historyCursor ? { cursor: historyCursor } : undefined }, { enabled: !!historyCursor && !!data });
  useEffect(() => { setHistoryCursor(null); setMoreHistory([]); setNextHistory(data?.page.hasMore ? data.page.cursor : null); }, [remote.data, caseId, jobId]);
  useEffect(() => {
    if (!historyCursor || historyPage.status !== "ready" || (historyPage.data.audience !== "reporter" && historyPage.data.audience !== "case_owner") || historyPage.data.job.jobId !== jobId) return;
    const result = historyPage.data;
    setMoreHistory(previous => { const seen = new Set([...(data?.history ?? []), ...previous].map(entry => entry.id)); return [...previous, ...result.history.filter(entry => !seen.has(entry.id))]; });
    setNextHistory(result.page.hasMore ? result.page.cursor : null); setHistoryCursor(null);
  }, [historyCursor, historyPage.status, historyPage.data]);
  const checking = !!local.value.pending || command.state === "checking"; const busy = command.state === "sending";
  async function send() {
    if (!data || (!data.actions.appendReport && !local.value.pending) || offline || busy || !local.value.description.trim() || !media.ready) return;
    const pending = local.value.pending ?? { operationId: uuid.v4(), caseId: data.receipt.id, eventId: uuid.v4(), language: locale, audience: null };
    const next = { ...local.value, pending }; try { await local.change(next); } catch { return; }
    const result = await command.run({ params: { id: data.receipt.id }, body: { operationId: operationIdSchema.parse(pending.operationId), payload: { id: caseEventIdSchema.parse(pending.eventId), kind: "reporter_update", content: { language: pending.language, text: next.description }, evidence: media.items.map(attachment => attachment.attachmentId) } } });
    if (result.ok) { await local.remove().catch(() => {}); await local.change(empty()).catch(() => {}); setEditing(false); void remote.refresh(); }
    else if (!("delivery" in result.error && result.error.delivery === "unknown")) await local.change({ ...next, pending: null }).catch(() => {});
  }
  return <CaseView data={data ? { ...data, history: [...data.history, ...moreHistory] } : null} status={remote.status} hasMore={!!nextHistory} moreBusy={historyPage.status === "loading"} onMore={() => { if (historyCursor) void historyPage.refresh(); else if (nextHistory) setHistoryCursor(nextHistory); }} twoClock={preferences?.twoClock ?? false} editing={editing || checking} message={local.value.description} checking={checking} busy={busy || !local.loaded} failed={local.failed || media.failed || command.state === "failed" || command.state === "conflict"} offline={offline} waitingMedia={!media.ready}
    attachments={<CaseAttachments items={media.items} offline={offline} locked={checking || busy || !data?.actions.appendReport} onAdd={() => media.handle(media.add())} onRemove={item => media.handle(media.remove(item))} onOpen={media.open} onRetry={id => media.handle(media.retry(id))} />}
    onEvidence={(item, eventId) => open(item.attachmentId, { caller: "case", parentScopeId: eventId }, { titleContext: data?.receipt.reference, ...(item.kind === "photo" && item.caption && { caption: { original: item.caption.original.text, originalLanguage: item.caption.original.language } }) })}
    onMessage={description => { void local.change({ ...local.value, description }).catch(() => {}); }} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onAdd={() => setEditing(true)} onSend={() => { void send(); }} onReview={() => router.push(`/c/jobs/${jobId}/completion` as Href)} />;
}

type CaseProps = { data: Participant | null; status: RemoteStatus; hasMore?: boolean; moreBusy?: boolean; onMore?: () => void; twoClock?: boolean; editing: boolean; message: string; checking: boolean; busy: boolean; failed: boolean; offline: boolean; waitingMedia?: boolean; attachments?: ReactNode; onEvidence?: (item: Evidence, eventId: string) => void; onMessage: (value: string) => void; onBack: () => void; onRetry: () => void; onAdd: () => void; onSend: () => void; onReview: () => void };
export function CaseView({ data, status, hasMore = false, moreBusy = false, onMore, twoClock = false, editing, message, checking, busy, failed, offline, waitingMedia, attachments, onEvidence, onMessage, onBack, onRetry, onAdd, onSend, onReview }: CaseProps) {
  const t = useT();
  const format = useFormat();
  const { color, space } = useBeaconTheme();
  const read = status === "ready" ? data : null;
  const viewerZone = twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const opened = read ? format.lines(read.receipt.openedAt, read.job.siteZone, viewerZone) : null;
  const reported = read ? (read.report.at === read.receipt.openedAt ? opened : format.lines(read.report.at, read.job.siteZone, viewerZone)) : null;
  const acknowledge = read ? format.lines(read.receipt.acknowledgeBy, read.job.siteZone, viewerZone) : null;
  const firstUpdate = read ? format.lines(read.receipt.firstUpdateBy, read.job.siteZone, viewerZone) : null;
  const nextUpdate = read?.receipt.nextUpdateAt ? format.lines(read.receipt.nextUpdateAt, read.job.siteZone, viewerZone) : null;
  const signed = read?.signOff ? format.lines(read.signOff.at, read.job.siteZone, viewerZone) : null;
  const dock = read && (editing
    ? <Dock context={checking ? t("mobile.case.checking") : offline ? t("mobile.case.offline") : waitingMedia ? t("mobile.photos.wait") : undefined} primary={{ label: checking ? t("mobile.case.checkAgain") : t("mobile.case.sendMessage"), onPress: onSend, disabled: offline || busy || waitingMedia || !message.trim(), busy }} />
    : read.actions.appendReport ? <Dock primary={{ glyph: "+", label: t("mobile.case.add"), onPress: onAdd, disabled: busy }} />
      : read.actions.reviewCompletion ? <Dock primary={{ label: t("mobile.case.review"), onPress: onReview }} /> : undefined);
  return <Screen title={t("mobile.case.reported")} subtitle={read ? `${read.receipt.reference} · ${read.job.reference}` : undefined}
    navigation={{ kind: "back", label: t("mobile.case.back"), onPress: onBack }} dock={dock}>
    <ReadState status={status} retry={onRetry} />
    {read && <>
      <Card dense>
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: space.grid[2] }}>
          <Badge tone={read.receipt.state === "open" ? "attention" : "success"} label={statusLabel(t, read.receipt.state)} />
          {opened && <Copy variant="caption" style={{ color: color.muted }}>{opened.site}</Copy>}
        </View>
        {opened?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{opened.viewer}</Copy>}
        <Copy variant="sectionTitle">{categoryLabel(t, read.receipt.category)}</Copy>
        {read.affectedItem && <Copy variant="supporting">{read.affectedItem.label.reading?.status === "ready" ? read.affectedItem.label.reading.text : read.affectedItem.label.original.text}</Copy>}
        {read.affectedItem?.label.reading?.status === "ready" && <Copy variant="supporting" style={{ color: color.muted }}>{read.affectedItem.label.original.text}</Copy>}
        {read.bill && <Copy>{read.bill.number}</Copy>}
        <CaseText value={read.report.content} />
        {read.report.evidence.map(item => <CaseEvidence key={item.attachmentId} item={item} eventId={read.report.id} onOpen={onEvidence} />)}
      </Card>
      <StatusBanner state="last-confirmed" label={read.signOff ? signed ? t("mobile.case.signed", { name: read.signOff.actorDisplayName, time: signed.site }) : t("mobile.places.signedOff") : t("mobile.case.notSigned")} detail={signed?.viewer ?? undefined} />
      <Card dense>
        <Copy variant="label">{t("mobile.case.owner", { name: read.receipt.caseOwnerDisplayName })}</Copy>
        {acknowledge && <Copy variant="supporting">{t("mobile.case.ackTarget", { time: acknowledge.site })}</Copy>}
        {acknowledge?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{acknowledge.viewer}</Copy>}
        {firstUpdate && <Copy variant="supporting">{t("mobile.case.updateTarget", { time: firstUpdate.site })}</Copy>}
        {firstUpdate?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{firstUpdate.viewer}</Copy>}
        {nextUpdate && <Copy variant="supporting">{t("mobile.case.nextTarget", { time: nextUpdate.site })}</Copy>}
        {nextUpdate?.viewer && <Copy variant="supporting" style={{ color: color.muted }}>{nextUpdate.viewer}</Copy>}
      </Card>
      <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.case.history")}</Copy>
      {[...read.history].sort((a, b) => b.at - a.at).map(event => {
        const clock = format.lines(event.at, read.job.siteZone, viewerZone);
        return <View key={event.id} style={{ gap: space.grid[2] }}>
          <Stamp kind="system" title={eventLabel(t, event.kind)} time={clock?.site ?? ""} attribution={event.actorDisplayName} detail={clock?.viewer ?? undefined} />
          {event.content && <CaseText value={event.content} />}
          {event.evidence.map(item => <CaseEvidence key={item.attachmentId} item={item} eventId={event.id} onOpen={onEvidence} />)}
        </View>;
      })}
      <Stamp kind="system" title={t("mobile.case.received")} time={reported?.site ?? ""} attribution={read.report.actorDisplayName} detail={reported?.viewer ?? undefined} />
      {hasMore && <Button variant="quiet" label={t("mobile.case.showEarlier")} onPress={onMore ?? onRetry} disabled={moreBusy} busy={moreBusy} />}
      {editing && <><TextField label={t("mobile.case.message")} value={message} multiline maxLength={4000} disabled={checking || busy} onChangeText={onMessage} />{attachments}</>}
      {failed && <StatusBanner state="not-sent" label={t("mobile.case.failed")} />}
    </>}
  </Screen>;
}

function CaseText({ value }: { value: Participant["report"]["content"] }) {
  const t = useT();
  const reading = value.reading;
  if (!reading || (reading.status === "ready" && reading.language === value.original.language)) {
    return <Copy accessibilityLanguage={value.original.language}>{value.original.text}</Copy>;
  }
  const original = { text: value.original.text, label: t("mobile.customerQuote.original", { language: readingLanguageLabel(t, value.original.language) }) };
  if (reading.status === "ready") {
    return <TwinCard state="translated" original={original} translation={{ text: reading.text, label: t("mobile.customerQuote.translation", { language: readingLanguageLabel(t, reading.language) }) }} />;
  }
  return <TwinCard state={reading.status} original={original} status={reading.status === "pending" ? t("mobile.customerQuote.pending") : t("mobile.customerQuote.unavailable")} />;
}
