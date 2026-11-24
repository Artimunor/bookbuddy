import { getShiftRoute, type ShiftDetail } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useRemote } from "../../api";
import type { RemoteStatus } from "../../api/requests";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { CrewDots } from "../../ui/live/CrewDots";
import { HoldBanner } from "../../ui/live/HoldBanner";
import { formatTime } from "../f-10/Screen";

type ForemanShift = Extract<ShiftDetail, { view: "foreman" }>;
export default function ShiftScreen() {
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>(); const router = useRouter();
  const remote = useRemote(getShiftRoute, { params: { s: shiftId ?? "" } }, { enabled: !!shiftId });
  const data = remote.data?.view === "foreman" ? remote.data : null;
  const gap = data?.slots.find(slot => slot.coverGapId)?.coverGapId ?? null;
  return <ShiftView data={data} status={remote.status} gapId={gap} onBack={() => router.back()} onRetry={() => { void remote.refresh(); }} onCover={() => gap && router.push(`/f/cover/${gap}` as Href)} onAssign={() => data && router.push(`/f/jobs/${data.shift.job.id}/assign?shiftId=${encodeURIComponent(data.shift.id)}` as Href)} onShare={() => data && router.push(`/f/jobs/${data.shift.job.id}/share` as Href)} onBriefing={id => router.push(`/safety/${id}` as Href)} onLog={() => data && router.push(`/f/jobs/${data.shift.job.id}/site-log` as Href)} />;
}

export function ShiftView({ data, status, gapId, onBack, onRetry, onCover, onAssign, onShare, onBriefing, onLog }: { data: ForemanShift | null; status: RemoteStatus; gapId: string | null; onBack: () => void; onRetry: () => void; onCover: () => void; onAssign: () => void; onShare: () => void; onBriefing: (id: string) => void; onLog: () => void }) {
  const t = useT(); const format = useFormat(); const time = (at: number) => formatTime(format, at, data?.shift.siteZone ?? "");
  const assignments = data?.slots.flatMap(slot => slot.assignments) ?? [];
  const dropped = data?.nextAction === "find_cover"; const ready = status === "ready";
  const dock = !data || data.shift.state === "cancelled" ? undefined : data.nextAction === "find_cover" ? <Dock primary={{ label: t("mobile.cover.title"), onPress: onCover, disabled: !ready || !gapId }} context={t("mobile.cover.ownCrewFirst")} /> : data.nextAction === "assign_crew" ? <Dock primary={{ label: t("mobile.cover.assign"), onPress: onAssign, disabled: !ready }} /> : data.nextAction === "share_update" ? <Dock primary={{ label: t("mobile.cover.share"), onPress: onShare, live: true, disabled: !ready }} /> : undefined;
  const customer = data?.customerUpdate;
  return <Screen title={t("mobile.cover.shift")} navigation={{ kind: "back", label: t("mobile.cover.back"), onPress: onBack }} dock={dock}>
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.cover.loading")}</Copy>}
    {(status === "error" || status === "offline") && <><Copy>{t("mobile.cover.unavailable")}</Copy><Button label={t("mobile.cover.retry")} onPress={onRetry} /></>}
    {data && <><Copy variant="supporting">{data.shift.job.reference} · {data.shift.job.title}</Copy>
      <Card><Copy variant="label">{dropped ? t("mobile.cover.gap") : t("mobile.cover.shift")}</Copy><Copy variant="sectionTitle">{time(data.shift.startsAt)} – {time(data.shift.endsAt)}</Copy><Copy>{data.shift.siteZone} · {data.shift.placeAlias}</Copy><Copy>{data.shift.task} · {data.shift.skill} · {data.shift.briefingLanguage}</Copy></Card>
      <Card><Copy variant="sectionTitle">{t("mobile.cover.crewHeading")}</Copy>{!assignments.length && <Copy>{t("mobile.cover.noCrew")}</Copy>}
        {assignments.map(a => { const reason = a.state === "dropped" && a.dropoutReason ? ` · ${{ transport: t("mobile.cover.reasonTransport"), another_job: t("mobile.cover.reasonJob"), personal: t("mobile.cover.reasonPersonal") }[a.dropoutReason]}` : ""; const label = a.state === "dropped" ? `${t("mobile.cover.out")} · ${time(a.droppedAt)}${reason}` : `${a.source === "cover" ? t("mobile.cover.coverAssignment", { name: a.confirmedByName }) : t("mobile.cover.assigned")} · ${time(a.confirmedAt)}`; return <CrewDots key={a.id} audience="foreman" people={[{ id: a.member.id, name: a.member.displayName, initials: a.member.displayName.split(/\s+/).map(x => x[0]).slice(0, 2).join(""), status: a.state === "dropped" ? "gap" : a.source === "cover" ? "replaced" : "confirmed", statusLabel: label }]} />; })}
        {data.slots.map(slot => slot.pendingOffer && <Copy key={slot.id}>{t("mobile.cover.pendingOffer", { name: slot.pendingOffer.recipientName, time: time(slot.pendingOffer.replyBy) })}</Copy>)}
        {dropped && <Copy variant="supporting">{t("mobile.cover.ownBriefing")}</Copy>}</Card>
      {data.holds.map(hold => <Card key={hold.id}><HoldBanner state="briefingRequired" label={t("mobile.cover.hold")} blocked={t("mobile.cover.holdDetail")} action={t("mobile.cover.briefing")} />{hold.instruction && <><Copy>v{hold.instruction.version}</Copy><Button variant="quiet" label={t("mobile.cover.briefing")} onPress={() => onBriefing(hold.instruction!.id)} /></>}</Card>)}
      <Card><Copy variant="label">{t("mobile.cover.customer")}</Copy><Copy>{customer?.state === "published" ? t("mobile.cover.shared", { time: time(customer.publishedAt) }) : customer?.state === "pending" ? t("mobile.cover.pendingUpdate") : t("mobile.cover.notShared")}</Copy><Button variant="quiet" label={t("mobile.cover.siteLog")} onPress={onLog} /></Card>
    </>}
  </Screen>;
}
