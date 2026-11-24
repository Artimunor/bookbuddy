import { getSessionHostOffersRoute, listMySessionHostOffersRoute, replyToSessionHostOfferRoute, sessionHostAssignmentIdSchema, sessionListingIdSchema, sessionSlotIdSchema, type RouteResponse } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useRef, useState } from "react";
import { useCommand, useRemote } from "../../api";
import { useApiAccess } from "../../api/provider";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Button, Card, Dock, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { TwoClock } from "../../ui/live";
import { Notice, useSessionDisplay } from "../l-01/common";
import { useDeadline } from "../s-02/flow";
import { confirmAction } from "../s-17/confirmAction";

type HostOffer = RouteResponse<typeof replyToSessionHostOfferRoute.output>;
type Decision = "accept" | "decline";

export function useSessionHostOffers(loadOnMount = true) {
  const { bootstrap } = useSession();
  const capability = bootstrap?.capabilities?.sessions;
  const active = bootstrap?.activeContext;
  const enabled = active?.role === "worker" && !!capability && "businessId" in capability && capability.businessId === active.businessId;
  return { enabled, remote: useRemote(listMySessionHostOffersRoute, {}, { enabled, loadOnMount }) };
}

export default function SessionHostOfferScreen({ offerId, listingId, slotId }: { offerId: string; listingId: string; slotId: string }) {
  const router = useRouter();
  const t = useT();
  const display = useSessionDisplay();
  const { bootstrap } = useSession();
  const { offline } = useApiAccess();
  const { enabled, remote: list } = useSessionHostOffers(false);
  const valid = sessionHostAssignmentIdSchema.safeParse(offerId).success && sessionListingIdSchema.safeParse(listingId).success &&
    sessionSlotIdSchema.safeParse(slotId).success;
  const reply = useCommand(replyToSessionHostOfferRoute, { resourceId: offerId });
  const listed = list.status === "ready" ? list.data.offers.find(offer => offer.id === offerId && offer.listingId === listingId && offer.slotId === slotId) : undefined;
  const detail = useRemote(getSessionHostOffersRoute, { params: { id: listingId }, query: { slotId } },
    { enabled: enabled && valid, loadOnMount: !listed && !reply.result });
  const reads = useRef({ list, detail });
  reads.current = { list, detail };
  const current = detail.status === "ready" ? detail.data.offers.find(offer => offer.id === offerId) : undefined;
  const offer: HostOffer | undefined = enabled && valid && !offline ? reply.result ?? current ?? (detail.status !== "ready" && !detail.error ? listed : undefined) : undefined;
  const offerRef = useRef(offer);
  offerRef.current = offer;
  const [pending, setPending] = useState<Decision>();
  const lock = useRef(false);
  const remaining = useDeadline(offer?.cover.status === "offered" ? offer.cover.expiresAt : 0);
  const checking = reply.state === "checking" && pending !== undefined;
  const busy = reply.state === "sending";
  const actionable = offer?.cover.status === "offered" && remaining > 0;
  const clock = offer && display.clock(offer.startsAt, offer.endsAt, offer.siteZone);
  const back = () => { if (router.canGoBack()) router.back(); else router.replace("/w/(tabs)/now" as Href); };

  async function send(decision: Decision) {
    if (!enabled || !valid || lock.current) return "invalidated";
    lock.current = true;
    try {
      const result = await reply.run({ params: { id: listingId }, body: { payload: { kind: "reply_cover", slotId, assignmentId: offerId, decision } } });
      if (result.ok) {
        const { list, detail } = reads.current;
        // The inbox only lists unanswered offers. Update existing reads, not a new request.
        if (list.status === "ready") list.seed({ offers: list.data.offers.filter(item => item.id !== offerId) }, result.meta.serverTime);
        if (detail.status === "ready") detail.seed({ offers: detail.data.offers.map(item => item.id === offerId ? result.data : item) }, result.meta.serverTime);
        setPending(undefined);
        return "confirmed";
      }
      if (result.error.code === "INTERNAL_ERROR" || ("delivery" in result.error && result.error.delivery === "unknown")) {
        setPending(decision);
        return "uncertain";
      }
      setPending(undefined);
      return "invalidated";
    } finally { lock.current = false; }
  }

  function review(decision: Decision) {
    if (!offer || !actionable || busy || checking || offline) return;
    const accept = decision === "accept";
    const label = accept ? t("mobile.workerOffer.accept") : t("mobile.workerOffer.decline");
    confirmAction(router, {
      title: label, actionLabel: label, actionLabelKey: accept ? "mobile.workerOffer.accept" : "mobile.workerOffer.decline",
      item: `${offer.title} · ${display.absolute(offer.startsAt, offer.siteZone)}`, actor: bootstrap?.account.displayName ?? "", role: offer.roleLabel,
      effects: [accept ? t("mobile.sessionHostOffer.acceptEffect") : t("mobile.sessionHostOffer.declineEffect")], destructive: !accept,
      onConfirm: async () => offerRef.current === offer && Date.now() < offer.cover.expiresAt ? send(decision) : "invalidated",
      onReview: () => { void detail.refresh(); },
    });
  }

  const status = offer?.cover.status === "accepted" ? t("mobile.sessionHostOffer.awaiting") : offer?.cover.status === "confirmed" ? t("mobile.sessionHostOffer.confirmed") :
    offer?.cover.status === "declined" ? t("mobile.workerOffer.declined") : offer?.cover.status === "withdrawn" ? t("mobile.workerOffer.withdrawn") :
    offer?.cover.status === "expired" || offer?.cover.status === "offered" && !actionable ? t("mobile.workerOffer.expired") : undefined;
  const noOffer = !enabled || !valid || detail.status === "ready" || detail.error?.code === "NOT_FOUND";
  const dock = checking && !offline && pending ? <Dock context={t("mobile.workerOffer.checking")}
    primary={{ label: t("mobile.laterCustomer.checkResult"), onPress: () => { void send(pending); }, busy }} /> : actionable ? <Dock context={t("mobile.sessionHostOffer.acceptEffect")}
    primary={{ label: t("mobile.workerOffer.accept"), onPress: () => review("accept"), busy }}
    secondary={{ label: t("mobile.workerOffer.decline"), onPress: () => review("decline"), disabled: busy }} /> : undefined;
  return <Screen title={t("mobile.sessionHostOffer.title")} navigation={{ kind: "back", label: t("mobile.workerOffer.back"), onPress: back }} dock={dock}>
    {offer ? <Card>
      <Copy variant="sectionTitle">{offer.title}</Copy>
      <Copy>{offer.roleLabel} · {display.language(offer.language)}</Copy>
      <Copy variant="supporting">{display.date(offer.startsAt, offer.siteZone)}</Copy>
      {clock && <TwoClock siteTime={clock.time} siteZone={clock.zone} viewerLine={clock.viewer} />}
      {status ? <Notice tone={offer.cover.status === "confirmed" ? "success" : "info"} title={status}>
        {offer.cover.status === "accepted" && <Copy>{t("mobile.sessionHostOffer.acceptEffect")}</Copy>}
      </Notice> :
        <Copy variant="supporting">{t("mobile.workerOffer.replyBy", { time: display.absolute(offer.cover.expiresAt, offer.siteZone) })}</Copy>}
    </Card> : <Copy>{offline ? t("mobile.workerOffer.offline") : noOffer ? t("mobile.laterCustomer.unavailable") :
      detail.status === "error" ? t("mobile.workerOffer.error") : t("mobile.workerOffer.loading")}</Copy>}
    {!offer && !offline && !noOffer && detail.status === "error" && <Button label={t("mobile.workerOffer.retry")} onPress={() => { void detail.refresh(); }} />}
  </Screen>;
}
