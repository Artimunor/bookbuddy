import { getJobRoute, getVisitLogRoute, type CustomerUpdate, type VisitLog } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState, type ReactNode } from "react";
import { useRemote } from "../../api";
import { useFormat, useT } from "../../i18n";
import { useOpenMediaPreview, type MediaPreviewDetails, type MediaScope } from "../../media";
import { useMediaReadBatch } from "../../media/read-batch";
import { Button, Card, Dock, Screen, SegmentedControl, Thumb } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { time } from "../c-06/Screen";

type AllLog = Extract<VisitLog, { view: "all" }>;
type Entry = AllLog["stamps"][number];
type ProgressStamp = Extract<Entry, { kind: "progress_photo" }>;
type UpdateStamp = Extract<CustomerUpdate, { kind: "photo" }>;
type Photo = ProgressStamp["photo"];
type T = ReturnType<typeof useT>;
function updateTitle(t: T, u: CustomerUpdate) {
  switch (u.kind) {
    case "on_the_way": return t("mobile.siteLog.onWay");
    case "arrival_revised": return t("mobile.siteLog.arrivalRevised");
    case "arrival_withdrawn": return t("mobile.siteLog.withdrawn");
    case "on_site": return t("mobile.siteLog.crewOnSite");
    case "cover_arranging": return t("mobile.siteLog.cover");
    case "no_crew_available": return t("mobile.liveVisit.noCrew");
    case "paused": return t("mobile.siteLog.paused");
    case "photo": return t("mobile.siteLog.photo");
    case "crew_confirmed": return t("mobile.siteLog.crewConfirmed");
    case "crew_updated": return t("mobile.siteLog.crewUpdated");
    case "working": return t("mobile.siteLog.working");
    case "finished": return t("mobile.siteLog.finished");
  }
}
function entryTitle(t: T, e: Entry) {
  switch (e.kind) {
    case "attendance": return e.event.kind === "arrival" ? t("mobile.siteLog.checkedIn") : t("mobile.siteLog.checkedOut");
    case "correction_request": return t("mobile.siteLog.correction");
    case "setting_off": return t("mobile.siteLog.onWay");
    case "work": return e.activity.kind === "work_started" ? t("mobile.siteLog.working") : e.activity.kind === "work_finished" ? t("mobile.siteLog.finished") : t("mobile.siteLog.paused");
    case "progress_photo": return t("mobile.siteLog.photo");
    case "arrival_plan_set": return t("mobile.siteLog.arrivalPlan");
    case "customer_update": return updateTitle(t, e.update);
  }
}
export default function SiteLogScreen() {
  const { jobId, visitId, shiftId } = useLocalSearchParams<{ jobId: string; visitId?: string; shiftId?: string }>();
  const router = useRouter(); const [view, setView] = useState<"all" | "customer">("all"); const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const job = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "today" } }, { enabled: !!jobId && !visitId });
  const currentVisit = visitId ?? (job.data?.audience === "foreman" && job.data.job.view === "today" ? job.data.job.visit.visitId : undefined);
  const log = useRemote(getVisitLogRoute, { params: { id: currentVisit ?? "" }, query: { view, ...(shiftId ? { shiftId } : {}), ...(pages.at(-1) ? { cursor: pages.at(-1) } : {}) } }, { enabled: !!currentVisit });
  const open = useOpenMediaPreview();
  const share = (stamp?: ProgressStamp, parent?: string) => router.push({ pathname: "/f/jobs/[jobId]/share", params: { jobId, ...(currentVisit && { visitId: currentVisit }), ...(stamp && parent && { progressEventId: stamp.id, attachmentId: stamp.photo.attachmentId, shiftId: parent }) } } as Href);
  const props: Props = { data: log.data ?? null, status: !currentVisit ? job.status : log.status, view, onView: v => { setPages([undefined]); setView(v); }, onBack: () => router.back(), onRetry: () => { if (currentVisit) void log.refresh(); else void job.refresh(); }, onShare: () => share(), onShareProgress: share, onPhoto: open, onWrap: () => router.push(`/f/jobs/${jobId}/wrap-up` as Href), onHold: id => router.push(`/safety/${id}` as Href), onChange: () => router.push(`/f/jobs/${jobId}/change` as Href), onPrevious: pages.length > 1 ? () => setPages(pages.slice(0, -1)) : undefined, onNext: log.data?.page.hasMore && log.data.page.cursor ? () => setPages([...pages, log.data!.page.cursor!]) : undefined };
  const groups = new Map<string, { scope: MediaScope; ids: string[] }>();
  const add = (stamp: ProgressStamp | UpdateStamp, parent: string | null) => {
    if (!parent || stamp.photo.availability !== "available") return;
    const scope = { caller: stamp.kind === "progress_photo" ? "progress" as const : "update" as const, parentScopeId: parent };
    const key = `${scope.caller}:${scope.parentScopeId}`;
    const group = groups.get(key);
    if (group) group.ids.push(stamp.photo.attachmentId);
    else groups.set(key, { scope, ids: [stamp.photo.attachmentId] });
  };
  if (props.status === "ready" && props.data) {
    if (props.data.view === "all") {
      for (const stamp of props.data.stamps) {
        if (stamp.kind === "progress_photo") add(stamp, stamp.shiftId ?? props.data.shiftId);
        if (stamp.kind === "customer_update" && stamp.update.kind === "photo") add(stamp.update, stamp.update.id);
      }
    } else {
      for (const stamp of props.data.stamps) if (stamp.kind === "photo") add(stamp, stamp.id);
    }
  }
  const render = [...groups].sort(([a], [b]) => a.localeCompare(b)).reduceRight<(url?: LogPhotoUrl) => ReactNode>(
    (next, [key, group]) => url => <LogPhotoGroup key={key} scope={group.scope} ids={group.ids} previous={url}>{next}</LogPhotoGroup>,
    photoUrl => <SiteLogView {...props} photoUrl={photoUrl} />,
  );
  return render();
}
type Props = { data: VisitLog | null; status: string; view: "all" | "customer"; onView: (v: "all" | "customer") => void; onBack: () => void; onRetry: () => void; onShare: () => void; onShareProgress?: (stamp: ProgressStamp, shiftId: string) => void; onPhoto?: (id: Photo["attachmentId"], scope: MediaScope, details?: MediaPreviewDetails) => void; onWrap: () => void; onHold: (id: string) => void; onChange: () => void; onPrevious?: () => void; onNext?: () => void };

type LogPhotoUrl = (scope: MediaScope, attachmentId: string) => string | undefined;

function LogPhotoGroup({ scope, ids, previous, children }: { scope: MediaScope; ids: string[]; previous?: LogPhotoUrl; children: (url: LogPhotoUrl) => ReactNode }) {
  const urls = useMediaReadBatch(ids, scope);
  return children((requested, attachmentId) => requested.caller === scope.caller && requested.parentScopeId === scope.parentScopeId ? urls.get(attachmentId) : previous?.(requested, attachmentId));
}

function LogPhoto({ stamp, parent, onOpen, photoUrl }: { stamp: ProgressStamp | UpdateStamp; parent?: string | null; onOpen?: Props["onPhoto"]; photoUrl?: LogPhotoUrl }) {
  const t = useT();
  const { photo, caption } = stamp;
  const reading = caption?.reading?.status === "ready" ? caption.reading : undefined;
  const scope = parent ? { caller: stamp.kind === "progress_photo" ? "progress" as const : "update" as const, parentScopeId: parent } : null;
  const access = photo.availability === "available" && scope && onOpen ? () => onOpen(photo.attachmentId, scope, {
    author: stamp.kind === "progress_photo" ? stamp.actorName : stamp.sharedByName,
    ...(caption && { caption: { original: caption.original.text, originalLanguage: caption.original.language, translation: reading?.text, translationLanguage: reading?.language } }),
  }) : undefined;
  return <>{caption && <Copy accessibilityLanguage={reading?.language ?? caption.original.language}>{reading?.text ?? caption.original.text}</Copy>}
    {photo.availability === "available" ? <Thumb uri={scope ? photoUrl?.(scope, photo.attachmentId) : undefined} label={reading?.text ?? caption?.original.text ?? t("mobile.case.evidencePhoto")} onPress={access} /> : <Copy>{t("mobile.siteLog.photoUnavailable")}</Copy>}
  </>;
}
export function SiteLogView(p: Props & { photoUrl?: LogPhotoUrl }) {
  const t = useT(); const format = useFormat(); const all = p.data?.view === "all" ? p.data : null; const control = all?.control; const zone = control?.siteZone ?? (p.data?.view === "customer" ? p.data.siteZone : "");
  const finished = control?.work?.kind === "work_finished";
  return <Screen title={t("mobile.siteLog.title")} subtitle={control ? [control.job.reference, control.job.title].filter(Boolean).join(" · ") : undefined} navigation={{ kind: "back", label: t("mobile.siteLog.back"), onPress: p.onBack }} dock={<Dock primary={{ label: finished ? t("mobile.siteLog.wrap") : t("mobile.siteLog.share"), live: !finished, onPress: finished ? p.onWrap : () => p.onShare(), disabled: p.status !== "ready" }} />}>
    {(p.status === "idle" || p.status === "loading") && <Copy>{t("mobile.siteLog.loading")}</Copy>}
    {(p.status === "error" || p.status === "offline") && <><Copy>{t("mobile.siteLog.unavailable")}</Copy><Button label={t("mobile.siteLog.retry")} onPress={p.onRetry} /></>}
    {control && control.crew.map(worker => worker.holds.map(hold => <Card key={hold.id}><Copy variant="sectionTitle">{hold.state === "active" ? t("mobile.siteLog.holdActive") : t("mobile.siteLog.holdCleared")}</Copy><Copy>{worker.workerName}</Copy>{hold.instruction && <><Copy>{t("mobile.siteLog.instruction", { number: hold.instruction.version.no })}</Copy><Button variant="quiet" label={t("mobile.siteLog.openSafety")} onPress={() => p.onHold(hold.instruction!.instructionId)} /></>}</Card>))}
    <SegmentedControl label={t("mobile.siteLog.audience")} options={[{ value: "all", label: t("mobile.siteLog.everything") }, { value: "customer", label: t("mobile.siteLog.customerView") }]} value={p.view} onChange={p.onView} />
    {p.data && p.data.stamps.length === 0 && <Copy>{t("mobile.siteLog.empty")}</Copy>}
    {all?.stamps.map((e, i) => {
      const at = e.kind === "customer_update" ? e.update.recordedAt : e.at;
      const actor = e.kind === "customer_update" ? ("sharedByName" in e.update ? e.update.sharedByName : "") : e.actorName;
      const visible = e.kind === "customer_update" || ("customerUpdateId" in e && !!e.customerUpdateId);
      const photoShift = e.kind === "progress_photo" ? e.shiftId ?? all.shiftId : null;
      return <Card key={`${at}-${i}`}><Copy variant="sectionTitle">{entryTitle(t, e)} · {time(format, at, zone)}</Copy><Copy>{actor}</Copy>
        {e.kind === "attendance" && <><Copy>{e.event.source === "self" ? t("mobile.siteLog.self") : e.event.source === "assisted" ? t("mobile.siteLog.assisted") : t("mobile.siteLog.manual")}</Copy>{e.event.reviewState !== "accepted" && <Copy>{t("mobile.siteLog.needsReview")}</Copy>}{e.event.correctsId && <Copy>{t("mobile.siteLog.corrected")}</Copy>}</>}
        {e.kind === "progress_photo" && <LogPhoto stamp={e} parent={photoShift} onOpen={p.onPhoto} photoUrl={p.photoUrl} />}
        {e.kind === "customer_update" && e.update.kind === "photo" && <LogPhoto stamp={e.update} parent={e.update.id} onOpen={p.onPhoto} photoUrl={p.photoUrl} />}
        {e.kind === "arrival_plan_set" && <Copy>{e.original.text}</Copy>}
        <Copy variant="supporting">{visible ? t("mobile.siteLog.customerVisible") : t("mobile.siteLog.crewOnly")}</Copy>
        {e.kind === "progress_photo" && e.canShareWithCustomer && e.photo.availability === "available" && photoShift && p.status === "ready" && control && p.onShareProgress && <Button variant="quiet" label={t("mobile.photos.shareWith", { name: control.customerName })} onPress={() => p.onShareProgress?.(e, photoShift)} />}
      </Card>;
    })}
    {p.data?.view === "customer" && p.data.stamps.map(u => <Card key={u.id}><Copy variant="sectionTitle">{updateTitle(t, u)} · {time(format, u.recordedAt, zone)}</Copy>{u.kind === "photo" && <LogPhoto stamp={u} parent={u.id} onOpen={p.onPhoto} photoUrl={p.photoUrl} />}</Card>)}
    {p.onPrevious && <Button variant="quiet" label={t("mobile.siteLog.previous")} onPress={p.onPrevious} />}{p.onNext && <Button variant="quiet" label={t("mobile.siteLog.next")} onPress={p.onNext} />}
    <Button variant="quiet" label={t("mobile.siteLog.change")} onPress={p.onChange} />
  </Screen>;
}
