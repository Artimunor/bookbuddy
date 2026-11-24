import { getJobRoute, getVisitLiveRoute, publishVisitUpdateRoute, type ForemanVisitControl } from "@bookbuddy/api-contract";
import { uuid } from "expo";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import type { CommandStatus, RemoteStatus } from "../../api/requests";
import { useLocale, useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Sheet } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ArrivalBand, LiveCapsule } from "../../ui/live";
import { clockTime } from "../f-05/Screen";
import { confirmAction } from "../s-17/confirmAction";

type Kind = "on_the_way" | "arrival_revised" | "paused" | "photo";
type Payload = { kind: "on_the_way"; band: { startsAt: number; endsAt: number } } | { kind: "arrival_revised"; correctsId: string; band: { startsAt: number; endsAt: number } } | { kind: "arrival_withdrawn"; correctsId: string } | { kind: "paused" };
export default function ShareUpdateScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>(); const router = useRouter(); const { bootstrap, session } = useSession(); const t = useT(); const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const jobRead = useRemote(getJobRoute, { params: { j: jobId ?? "" }, query: { view: "whole" } }, { enabled: !!jobId });
  const job = jobRead.data?.audience === "foreman" && jobRead.data.job.view === "whole" ? jobRead.data.job : null;
  const visitId = job?.nextVisit?.visitId; const visitRead = useRemote(getVisitLiveRoute, { params: { id: visitId ?? "" } }, { enabled: !!visitId });
  const data = visitRead.data && "workGate" in visitRead.data ? visitRead.data : null; const command = useCommand(publishVisitUpdateRoute);
  const status = jobRead.status !== "ready" ? jobRead.status : !visitId ? "error" : visitRead.status;
  async function publish(payload: Payload) {
    if (!data || status !== "ready" || command.state === "sending" || command.state === "checking" || !data.permittedUpdates.includes(payload.kind)) return false;
    const result = await command.run({ params: { id: data.visitId }, body: { expectedRevision: data.revision, payload: { ...payload, id: uuid.v4() } } });
    if (result.ok) { router.back(); return true; }
    return false;
  }
  function retract() {
    const arrival = data?.customerPreview.live.arrival; if (!data || !arrival || status !== "ready" || !data.permittedUpdates.includes("arrival_withdrawn")) return;
    confirmAction(router, { title: t("mobile.jobControl.retracted"), actionLabel: t("mobile.jobControl.retracted"), actionLabelKey: "mobile.jobControl.retracted", item: data.job.reference, actor: bootstrap?.account.displayName ?? "", role: session?.activeContext?.businessName ?? "", effects: [t("mobile.jobControl.append")], destructive: true, onReview: () => {}, onConfirm: async () => { const result = await command.run({ params: { id: data.visitId }, body: { expectedRevision: data.revision, payload: { id: uuid.v4(), kind: "arrival_withdrawn", correctsId: arrival.id } } }); if (result.ok) { await visitRead.refresh(); return "confirmed"; } return result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown") ? "uncertain" : "invalidated"; } });
  }
  return <ShareUpdateView key={data?.visitId ?? "loading"} visible={focused} data={data} status={status} commandState={command.state} onClose={() => router.back()} onRetry={() => { void jobRead.refresh(); if (visitId) void visitRead.refresh(); }} onSend={payload => { void publish(payload); }} onRetract={retract} />;
}
export function ShareUpdateView({ visible = true, data, status, commandState, onClose, onRetry, onSend, onRetract, initialKind, initialBand }: { visible?: boolean; data: ForemanVisitControl | null; status: RemoteStatus; commandState: CommandStatus; onClose: () => void; onRetry: () => void; onSend: (payload: Payload) => void; onRetract: () => void; initialKind?: Kind; initialBand?: { startsAt: number; endsAt: number } }) {
  const t = useT(), { locale } = useLocale(); const previous = data?.customerPreview.live.arrival;
  const [kind, setKind] = useState<Kind>(initialKind ?? (previous && data?.permittedUpdates.includes("arrival_revised") ? "arrival_revised" : data?.permittedUpdates.includes("on_the_way") ? "on_the_way" : "paused"));
  const [band, setBand] = useState(() => initialBand ?? previous?.band ?? { startsAt: Math.ceil(Date.now() / 300000) * 300000 + 600000, endsAt: Math.ceil(Date.now() / 300000) * 300000 + 1200000 });
  const at = (time: number) => clockTime(time, data?.siteZone ?? "UTC", locale); const range = `${at(band.startsAt)} – ${at(band.endsAt)}`;
  const options: { kind: Kind; label: string }[] = [{ kind: "on_the_way", label: t("mobile.jobControl.onWay") }, { kind: "arrival_revised", label: t("mobile.jobControl.late") }, { kind: "paused", label: t("mobile.jobControl.paused") }, { kind: "photo", label: t("mobile.jobControl.photo") }];
  const label = options.find(option => option.kind === kind)?.label ?? "";
  const allowed = !!data && kind !== "photo" && data.permittedUpdates.includes(kind) && (kind !== "arrival_revised" || !!previous) && status === "ready" && commandState !== "sending" && commandState !== "checking" && (kind === "paused" || band.endsAt > Date.now());
  const send = () => { if (!allowed) return; if (kind === "on_the_way") onSend({ kind, band }); else if (kind === "arrival_revised" && previous) onSend({ kind, band, correctsId: previous.id }); else if (kind === "paused") onSend({ kind }); };
  return <Sheet visible={visible} title={t("mobile.jobControl.shareTitle")} closeLabel={t("mobile.crew.close")} onClose={onClose} dock={data ? <Dock context={kind === "photo" ? t("mobile.jobControl.photoUnavailable") : !allowed ? t("mobile.jobControl.unavailableType") : t("mobile.jobControl.noLocation")} primary={{ label: t("mobile.jobControl.send"), onPress: send, disabled: !allowed, live: true }} /> : undefined}>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.foremanHome.loading")}</Copy>}{(status === "error" || status === "offline") && <><Copy>{status === "offline" ? t("mobile.foremanHome.offline") : t("mobile.jobControl.error")}</Copy><Button label={t("mobile.foremanHome.retry")} onPress={onRetry} /></>}
    {commandState === "checking" && <Copy>{t("mobile.jobControl.checking")}</Copy>}{(commandState === "failed" || commandState === "conflict") && <Copy>{t("mobile.jobControl.failed")}</Copy>}
    {commandState === "done" && <Copy>{t("mobile.jobControl.sent")}</Copy>}
    {data && <><Copy>{t("mobile.jobControl.to", { name: data.customerName })} · {data.job.reference}</Copy><View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{options.map(option => <Button key={option.kind} label={option.label} variant={option.kind === kind ? "primary" : "neutral"} disabled={option.kind === "photo" || !data.permittedUpdates.includes(option.kind)} onPress={() => setKind(option.kind)} />)}</View><Copy variant="supporting">{t("mobile.jobControl.photoUnavailable")}</Copy>
    {kind === "photo" ? <Card><Copy>{t("mobile.jobControl.photoUnavailable")}</Copy></Card> : kind === "paused" ? <Card><Copy>{t("mobile.jobControl.pauseNotice")}</Copy></Card> : <><Card>{kind === "arrival_revised" && previous && <><Copy variant="label">{t("mobile.jobControl.was")}</Copy><Copy>{at(previous.band.startsAt)} – {at(previous.band.endsAt)}</Copy><Copy>{t("mobile.jobControl.sharedAt", { name: previous.sharedByName, time: at(previous.recordedAt) })}</Copy></>}<ArrivalBand state="onTheWay" label={t("mobile.jobControl.arriving")} time={{ siteTime: range, siteZone: data.siteZone }} /><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button variant="neutral" label={t("mobile.jobControl.earlier")} onPress={() => setBand(current => ({ startsAt: current.startsAt - 300000, endsAt: current.endsAt - 300000 }))} /><Button variant="neutral" label={t("mobile.jobControl.later")} onPress={() => setBand(current => ({ startsAt: current.startsAt + 300000, endsAt: current.endsAt + 300000 }))} /></View>{kind === "arrival_revised" && data.permittedUpdates.includes("arrival_withdrawn") && <Button variant="quiet" label={t("mobile.jobControl.retracted")} onPress={onRetract} />}</Card></>}
    {kind !== "photo" && <><Copy variant="sectionTitle">{t("mobile.jobControl.preview")}</Copy><LiveCapsule state={kind === "paused" ? "paused" : "onTheWay"} stateLabel={kind === "paused" ? t("mobile.jobControl.paused") : t("mobile.jobControl.onWay")} source={data.job.title ?? data.job.reference} reference={data.job.reference} time={kind === "paused" ? undefined : range} zoneLine={data.siteZone} provenance="" accessibilityLabel={`${label}, ${kind === "paused" ? "" : range}`} /></>}
    <Copy variant="supporting">{t("mobile.jobControl.noLocation")}</Copy><Copy variant="supporting">{t("mobile.jobControl.append")}</Copy></>}
  </Sheet>;
}
