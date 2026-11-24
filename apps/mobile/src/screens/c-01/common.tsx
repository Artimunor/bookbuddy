import type { HomeProjection, JobsPage } from "@bookbuddy/api-contract";
import { JOURNEY_STEPS } from "@bookbuddy/domain";
import type { Translator } from "@bookbuddy/i18n";
import type { CachedRead } from "../../repository/remote-cache";
import { useFormat, useT } from "../../i18n";
import { Badge, BookingCard, Button, Card, IdentityChip, StatusBanner } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { JobLine, LiveCapsule, type LiveCapsuleState } from "../../ui/live";
import type { ReactNode } from "react";
import { siteWindow } from "./clock";

type Home = Extract<HomeProjection, { audience: "customer" }>;
export type CustomerCard = Extract<JobsPage, { audience: "customer" }>["items"][number];
export type CustomerLive = Home["liveVisits"][number];
export type Decision = Home["decisions"][number];

export function HeaderIdentity({ name, place, onPress }: { name: string | null; place: string | null; onPress: () => void }) {
  const t = useT();
  const display = name || t("mobile.customerHome.account");
  const initials = name ? name.trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase() : "";
  return <IdentityChip initials={initials} name={display} context={place || t("mobile.customerHome.addPlace")} onPress={onPress} />;
}
export function Bell({ count, onPress }: { count: number; onPress: () => void }) {
  const t = useT();
  return <Button iconOnly glyph="🔔︎" label={t("mobile.customerHome.notifications", { count })} variant="neutral" onPress={onPress} />;
}
export function OfflineNotice({ confirmed, zone }: { confirmed: number | null; zone: string | null }) {
  const t = useT(); const format = useFormat();
  const date = confirmed === null ? null : format.siteTime(confirmed, zone);
  return <StatusBanner state="offline" label={date?.kind === "available" ? t("mobile.customerHome.lastConfirmed", { time: date.siteTime }) : t("mobile.customerHome.offline")} />;
}
export function journeyLabels(t: Translator<"mobile">["t"]): [string, string, string, string, string, string] {
  return [t("mobile.customerHome.requested"), t("mobile.customerHome.quoted"), t("mobile.customerHome.booked"), t("mobile.customerHome.visit"), t("mobile.customerHome.signedOff"), t("mobile.customerHome.paid")];
}
export function Journey({ journey, quiet = false }: { journey: CustomerCard["journey"]; quiet?: boolean }) {
  const t = useT(); const labels = journeyLabels(t);
  const current = JOURNEY_STEPS.indexOf(journey.step) as 0 | 1 | 2 | 3 | 4 | 5;
  const stage = labels[current];
  return <JobLine kind="journey" steps={labels} current={current} compact pulse={false} activity={quiet ? "quiet" : journey.complete ? "finished" : "live"} status={journey.cancelled ? { state: "cancelled", label: t("mobile.customerHome.cancelled") } : undefined} accessibilityLabel={t("mobile.customerHome.step", { step: current + 1, stage })} />;
}
export function Booking({ item, onPress, quiet = false }: { item: CustomerCard; onPress: () => void; quiet?: boolean }) {
  const t = useT(); const format = useFormat();
  const title = item.title || t("mobile.customerHome.untitled");
  const stage = item.journey.cancelled ? t("mobile.customerHome.cancelled") : journeyLabels(t)[JOURNEY_STEPS.indexOf(item.journey.step) as 0 | 1 | 2 | 3 | 4 | 5];
  const date = item.nextVisit ? format.siteTime(item.nextVisit.window.startsAt, item.siteZone) : item.finalAt ? format.siteTime(item.finalAt, item.siteZone) : null;
  const next = item.nextStep?.waitingOn ? t("mobile.customerHome.waiting", { name: item.nextStep.waitingOn }) : date?.kind === "available" ? date.siteTime : undefined;
  const label = [title, item.reference, item.place.alias, item.providerName, stage, item.live && !quiet ? t("mobile.customerHome.live") : null, next].filter(Boolean).join(", ");
  return <BookingCard title={`${title} · ${item.reference}`} place={`${item.place.alias} · ${item.providerName}`} stage={item.live && !quiet ? t("mobile.customerHome.live") : stage} next={next} progress={<Journey journey={item.journey} quiet={quiet || !item.live} />} onPress={onPress} accessibilityLabel={label} />;
}
export function DecisionLabel({ decision }: { decision: Decision }) {
  const t = useT(); const format = useFormat();
  return <><Badge label={t("mobile.customerHome.decisionDue")} tone="attention" /><Copy variant="sectionTitle">{decisionAction(t, decision.kind)}{decision.amount ? ` · ${format.money(decision.amount.minor, decision.amount.currency)}` : ""}</Copy><Copy>{[decision.title || t("mobile.customerHome.untitled"), decision.reference, decision.place.alias].join(" · ")}</Copy><Journey journey={decision.journey} quiet /></>;
}
export function decisionAction(t: Translator<"mobile">["t"], kind: Decision["kind"]): string {
  switch (kind) {
    case "review_quote": return t("mobile.customerHome.reviewQuote");
    case "pick_window": return t("mobile.customerHome.pickWindow");
    case "review_revised_visit": return t("mobile.customerHome.reviewRevised");
    case "review_change": return t("mobile.customerHome.reviewChange");
    case "review_completion": return t("mobile.customerHome.reviewCompletion");
    case "sign_off": return t("mobile.customerHome.signOff");
    case "see_bill": return t("mobile.customerHome.seeBill");
  }
}
export function Live({ item, onPress, quiet = false, pill = false, twoClock = false }: { item: CustomerLive; onPress: () => void; quiet?: boolean; pill?: boolean; twoClock?: boolean }) {
  const t = useT(); const format = useFormat();
  const status = item.visit.status;
  const states: Record<typeof status, [LiveCapsuleState, string]> = {
    confirmed: ["crewConfirmed", t("mobile.customerHome.confirmed")], on_the_way: ["onTheWay", t("mobile.customerHome.onTheWay")],
    on_site: ["onSite", t("mobile.customerHome.onSite")], working: ["working", t("mobile.customerHome.working")], finished: ["finished", t("mobile.customerHome.finished")],
    cover_arranging: ["coverBeingArranged", t("mobile.customerHome.cover")], paused: ["paused", t("mobile.customerHome.paused")],
  };
  const [state, stateLabel] = states[status];
  const band = item.visit.arrival ?? item.visit.window;
  const viewerZone = twoClock ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const clocks = siteWindow(format, band.startsAt, band.endsAt, item.siteZone, viewerZone);
  const time = clocks ? `${clocks.time} ${clocks.zone}` : undefined;
  const at = format.siteTime(item.visit.source.at, item.siteZone);
  const sourceTime = at.kind === "available" ? `${at.site.time} ${format.zoneLabel(item.siteZone, at.site)}` : null;
  const provenance = !sourceTime ? "" : item.visit.source.by ? t("mobile.customerHome.shared", { name: item.visit.source.by, time: sourceTime }) : t("mobile.customerHome.confirmedAt", { time: sourceTime });
  const steps = [t("mobile.liveVisit.stepConfirmed"), t("mobile.liveVisit.stepWay"), t("mobile.liveVisit.stepSite"), t("mobile.liveVisit.working"), t("mobile.liveVisit.stepFinished")] as const;
  const step = item.visit.step;
  const current = step === "on_the_way" ? 1 : step === "on_site" ? 2 : step === "working" ? 3 : step === "finished" ? 4 : 0;
  const progress = t("mobile.liveVisit.step", { step: current + 1, stage: steps[current] });
  const title = item.title || t("mobile.customerHome.untitled");
  return <LiveCapsule size={pill ? "pill" : "card"} state={quiet ? "quiet" : state} pulse={false} stateLabel={stateLabel} source={title} reference={item.reference} time={time} zoneLine={clocks?.viewer ?? undefined} provenance={[item.crewName, item.providerName, provenance].filter(Boolean).join(" · ")}
    line={{ kind: "visit", steps: [...steps], current, accessibilityLabel: progress }} accessibilityLabel={[title, stateLabel, time, clocks?.viewer, progress, item.crewName, item.providerName, provenance].filter(Boolean).join(", ")} onPress={onPress} />;
}
export function Section({ title, children }: { title: string; children: ReactNode }) { return <><Copy variant="sectionTitle" accessibilityRole="header">{title}</Copy>{children}</>; }

type CachedHome = Extract<CachedRead<"home">, { audience: "customer" }>;
type CachedJobs = Extract<CachedRead<"jobs_list">, { audience: "customer" }>;
export function CachedBooking({ item }: { item: CachedJobs["items"][number] }) {
  const t = useT(); const format = useFormat();
  const date = item.nextVisit ? format.siteTime(item.nextVisit.window.startsAt, item.siteZone) : item.finalAt ? format.siteTime(item.finalAt, item.siteZone) : null;
  return <Card><Copy variant="sectionTitle">{item.title || t("mobile.customerHome.untitled")} · {item.reference}</Copy><Copy variant="supporting">{item.providerName}</Copy><Journey journey={item.journey} quiet />{date?.kind === "available" && <Copy>{date.siteTime}</Copy>}</Card>;
}
export function CachedVisit({ item }: { item: CachedHome["liveVisits"][number] }) {
  const t = useT(); const format = useFormat();
  const at = format.siteTime(item.visit.source.at, item.siteZone);
  return <Card><Copy variant="sectionTitle">{item.title || t("mobile.customerHome.untitled")} · {item.reference}</Copy><Copy>{item.providerName}</Copy><Copy>{at.kind === "available" ? t("mobile.customerHome.confirmedAt", { time: at.siteTime }) : t("mobile.customerHome.offline")}</Copy><Journey journey={item.journey} quiet /></Card>;
}
