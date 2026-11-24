import { listShiftsRoute, type ShiftAgenda } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { useRemote, type CachedRead } from "../../api";
import { useFormat, useT } from "../../i18n";
import { Button, Card, Screen, SegmentedControl } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { siteTime } from "../f-01/Screen";

type Segment = ShiftAgenda["segment"];
type Status = "idle" | "loading" | "ready" | "error" | "offline";
type Agenda = ShiftAgenda | CachedRead<"shift_agenda">;
export default function ShiftsScreen() {
  const [segment, setSegment] = useState<Segment>("upcoming");
  const [cursor, setCursor] = useState<string | undefined>();
  const [previous, setPrevious] = useState<Array<Agenda["rows"][number]>>([]);
  const remote = useRemote(listShiftsRoute, { query: { segment, cursor } }, { cache: { kind: "shift_agenda" } });
  const router = useRouter();
  return <ShiftsView data={remote.data} previous={previous} status={remote.status} lastConfirmedAt={remote.lastConfirmedAt} segment={segment} onSegment={next => { setPrevious([]); setCursor(undefined); setSegment(next); }} onRetry={() => void remote.refresh()} onMore={() => { if (remote.status !== "ready" || !remote.data.hasMore || !remote.data.cursor) return; const page = remote.data; setPrevious(rows => [...rows, ...page.rows]); setCursor(page.cursor!); }} onNavigate={path => router.push(path as Href)} />;
}
export function ShiftsView({ data, previous = [], status, lastConfirmedAt, segment, onSegment, onRetry, onMore, onNavigate }: { data: Agenda | null; previous?: Array<Agenda["rows"][number]>; status: Status; lastConfirmedAt: number | null; segment: Segment; onSegment: (s: Segment) => void; onRetry: () => void; onMore?: () => void; onNavigate: (path: string) => void }) {
  const t = useT(); const format = useFormat();
  const labels = { upcoming: t("mobile.crewSchedule.upcoming"), offers: t("mobile.crewSchedule.offers"), past: t("mobile.crewSchedule.past") };
  const rows = [...(status === "offline" ? [] : previous), ...(data?.segment === segment ? data.rows : [])];
  return <Screen title={t("mobile.crewSchedule.shifts")}>
    <Button label={t("mobile.crewSchedule.availability")} variant="quiet" onPress={() => onNavigate("/w/availability")} />
    <SegmentedControl label={t("mobile.crewSchedule.shifts")} value={segment} onChange={onSegment} options={(["upcoming", "offers", "past"] as const).map(value => ({ value, label: value === "upcoming" && data?.segment === "upcoming" && status === "ready" ? `${labels[value]} · ${data.total}` : labels[value] }))} />
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.crewSchedule.loading")}</Copy>}
    {status === "offline" && <><Copy>{t("mobile.crewSchedule.offline")}</Copy>{lastConfirmedAt !== null && rows[0] && <Copy>{t("shared.status.lastConfirmed", { time: siteTime(format, lastConfirmedAt, rows[0].kind === "shift" ? rows[0].shift.siteZone : rows[0].siteZone) })}</Copy>}</>}
    {data && data.segment === segment && rows.length === 0 && status === "ready" && <Copy>{segment === "upcoming" ? t("mobile.crewSchedule.emptyUpcoming") : segment === "offers" ? t("mobile.crewSchedule.emptyOffers") : t("mobile.crewSchedule.emptyPast")}</Copy>}
    {rows.map(row => { if (row.kind === "shift") { const s = row.shift; const when = `${siteTime(format, s.startsAt, s.siteZone)} – ${siteTime(format, s.endsAt, s.siteZone)}`; return <Card key={s.id}><Copy variant="sectionTitle">{s.job.title}</Copy><Copy>{s.job.reference} · {when}</Copy><Copy>{"task" in s && typeof s.task === "string" ? s.task : s.skill}</Copy><Copy>{"outcome" in row ? row.outcome : t("mobile.crewSchedule.confirmed")}</Copy><Button label={t("mobile.crewSchedule.openShift")} variant="quiet" onPress={() => onNavigate(`/w/shifts/${s.id}?assignmentId=${encodeURIComponent(row.assignment.id)}`)} /></Card>; }
      const when = `${siteTime(format, row.startsAt, row.siteZone)} – ${siteTime(format, row.endsAt, row.siteZone)}`; const gapId = row.source === "cover" && "gapId" in row && typeof row.gapId === "string" ? row.gapId : null; return <Card key={row.id}><Copy variant="sectionTitle">{row.areaName}</Copy><Copy>{when}</Copy>{"task" in row && typeof row.task === "string" && <Copy>{row.task}</Copy>}<Copy>{row.state === "awaiting_confirmation" ? t("mobile.crewSchedule.waiting") : t("mobile.crewSchedule.offer")}</Copy><Button label={t("mobile.crewSchedule.openOffer")} variant="quiet" disabled={row.source === "cover" && !gapId} onPress={() => onNavigate(`/w/offers/${row.id}${gapId ? `?gapId=${encodeURIComponent(gapId)}` : ""}`)} /></Card>; })}
    {status === "error" && <><Copy>{t("mobile.crewSchedule.error")}</Copy><Button label={t("mobile.crewSchedule.retry")} onPress={onRetry} /></>}
    {data?.hasMore && status === "ready" && onMore && <Button label={t("mobile.crewSchedule.more")} onPress={onMore} />}
  </Screen>;
}
