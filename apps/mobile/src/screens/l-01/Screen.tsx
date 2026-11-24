import { listSessionsRoute, type CustomerSessionCard, type RouteResponse } from "@bookbuddy/api-contract";
import type { Translator } from "@bookbuddy/i18n";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Button, Card, Dock, EmptyState, Screen, Sheet, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { ChoiceRadio } from "../s-12/ChoiceRadio";
import { detailHref, SessionSkeleton, useSessionDisplay, useSessionMarkets, useSessionsBack } from "./common";

const noMarkets: readonly string[] = [];
type Results = RouteResponse<typeof listSessionsRoute.output>;
type Filter = { areaId: string; locality: string; category?: string };
type BrowseProps = {
  sessions: readonly CustomerSessionCard[]; categories: readonly string[]; locality: string; category?: string;
  status: "loading" | "ready" | "offline" | "unavailable" | "error"; hasMore?: boolean; pageError?: boolean;
  onCategory: (category?: string) => void; onPlace?: () => void; onCard: (id: string) => void; onBack: () => void;
  onMore?: () => void; onRetry?: () => void;
};

export default function BrowseSessionsScreen() {
  const areas = useSessionMarkets() ?? noMarkets;
  const router = useRouter();
  const t = useT();
  const onBack = useSessionsBack();
  const [place, setPlace] = useState({ areaId: "", locality: "" });
  const [category, setCategory] = useState<string>();
  const [picker, setPicker] = useState<{ areaId: string; locality: string } | null>(null);
  const areaId = areas.includes(place.areaId) ? place.areaId : areas[0] ?? "";
  const locality = place.locality;
  return <>
    <BrowseResults key={JSON.stringify([areaId, locality, category])} filter={{ areaId, locality, category }} onCategory={setCategory}
      onCard={id => router.push(detailHref(id))} onBack={onBack} onPlace={areas.length ? () => setPicker({ areaId, locality }) : undefined} />
    {picker && <Sheet visible title={t("mobile.laterCustomer.changePlace")} closeLabel={t("mobile.laterCustomer.close")} onClose={() => setPicker(null)}
      dock={<Dock primary={{ label: t("mobile.laterCustomer.searchHere"), onPress: () => {
        setPlace({ areaId: picker.areaId, locality: picker.locality.trim() });
        if (picker.areaId !== areaId) setCategory(undefined);
        setPicker(null);
      } }} />}>
      {areas.length > 1 && <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.laterCustomer.marketGroup")} style={{ gap: 8 }}>
        {areas.map((id, index) => <ChoiceRadio key={id} label={t("mobile.laterCustomer.market", { number: index + 1 })}
          selected={picker.areaId === id} onPress={() => setPicker({ ...picker, areaId: id, locality: "" })} />)}
      </View>}
      <TextField label={t("mobile.laterCustomer.locality")} value={picker.locality} helper={t("mobile.laterCustomer.localityHelp")}
        maxLength={256} onChangeText={value => setPicker({ ...picker, locality: value })} />
    </Sheet>}
  </>;
}

function BrowseResults({ filter, onPlace, onCategory, onCard, onBack }: Pick<BrowseProps, "onPlace" | "onCategory" | "onCard" | "onBack"> & { filter: Filter }) {
  const { areaId, locality, category } = filter;
  const [page, setPage] = useState<{ cursor: string; prior: Results } | null>(null);
  const remote = useRemote(listSessionsRoute, { query: { areaId, ...(locality ? { locality } : {}), ...(category ? { category } : {}), ...(page ? { cursor: page.cursor } : {}) } }, { enabled: !!areaId });
  const root = useRemote(listSessionsRoute, { query: { areaId } }, { enabled: !!areaId && !!(locality || category), loadOnMount: false });
  const data = remote.status === "ready" ? remote.data : null;
  const prior = page?.prior;
  const sessions = data && prior ? [...prior.sessions, ...data.sessions] : (data ?? prior)?.sessions ?? [];
  const status = !areaId || remote.error?.code === "NOT_FOUND" ? "unavailable" : remote.status === "offline" ? "offline" :
    prior || data ? "ready" : remote.status === "error" ? "error" : "loading";
  const categories = (data ?? prior)?.categories ?? root.data?.categories ?? [];
  return <BrowseView status={status} locality={locality} category={category} categories={categories} sessions={status === "ready" ? sessions : []}
    onPlace={onPlace} onCard={onCard} onCategory={onCategory} onBack={onBack} onRetry={() => { void remote.refresh(); }}
    hasMore={!!data?.page.cursor} pageError={!!prior && remote.status === "error" && remote.error?.code !== "NOT_FOUND"}
    onMore={() => { if (data?.page.cursor) setPage({ cursor: data.page.cursor, prior: { ...data, sessions } }); }} />;
}

function categoryLabel(category: string, t: Translator<"mobile">["t"]) {
  switch (category) {
    case "pilates": return t("mobile.laterCustomer.pilates");
    case "massage": return t("mobile.laterCustomer.massage");
    case "sport_coaching": case "sport-coaching": return t("mobile.laterCustomer.coaching");
    case "tours": return t("mobile.laterCustomer.tours");
    default: return category.replace(/[_-]/g, " ");
  }
}

export function BrowseView({ sessions, categories, locality, category, status, hasMore, pageError, onCategory, onPlace, onCard, onBack, onMore, onRetry }: BrowseProps) {
  const t = useT();
  const display = useSessionDisplay();
  const first = sessions[0];
  const place = locality || first?.version.venue.locality;
  const placeLabel = place ? t("mobile.laterCustomer.near", { place }) : t("mobile.laterCustomer.allLocalities");
  const siteZone = first?.version.venue.siteZone;
  const zone = first && siteZone && sessions.every(item => item.version.venue.siteZone === siteZone) ? display.instant(first.nextSlot.startsAt, siteZone).zone : "";
  const emptyAction = category ? { label: t("mobile.laterCustomer.showAll"), onPress: () => onCategory() } :
    onPlace ? { label: t("mobile.laterCustomer.changePlace"), onPress: onPlace } : undefined;
  return <Screen title={t("mobile.laterCustomer.sessions")} navigation={{ kind: "back", label: t("mobile.laterCustomer.back"), onPress: onBack }}
    bell={onPlace ? <Button label={t("mobile.laterCustomer.changePlace")} variant="neutral" glyph="⌖" iconOnly onPress={onPlace} /> : undefined}>
    <Copy variant="supporting">{placeLabel}</Copy>
    {!!categories.length && <View accessibilityRole="radiogroup" accessibilityLabel={t("mobile.laterCustomer.categories")} style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <ChoiceRadio pill label={t("mobile.laterCustomer.all")} selected={!category} onPress={() => onCategory()} />
      {categories.map(slug => <ChoiceRadio key={slug} pill label={categoryLabel(slug, t)} selected={category === slug} onPress={() => onCategory(slug)} />)}
    </View>}
    {status === "loading" ? <SessionSkeleton /> : status !== "ready" ? <EmptyState
      title={status === "offline" ? t("mobile.laterCustomer.offline") : t("mobile.laterCustomer.unavailable")}
      description={status === "offline" ? t("mobile.laterCustomer.connect") : status === "error" ? t("mobile.laterCustomer.loadError") : t("mobile.laterCustomer.unavailableBody")}
      action={status === "error" && onRetry ? { label: t("mobile.laterCustomer.retry"), onPress: onRetry } : undefined} /> :
      !sessions.length ? <EmptyState title={place ? t("mobile.laterCustomer.noneNearby", { place }) : t("mobile.laterCustomer.none")}
        description={t("mobile.laterCustomer.noneBody")} action={emptyAction} /> : <>
        <Copy variant="sectionTitle" accessibilityRole="header">{t("mobile.laterCustomer.resultCount", { count: sessions.length })}</Copy>
        <Copy variant="supporting">{[t("mobile.laterCustomer.nextFirst"), zone].filter(Boolean).join(" · ")}</Copy>
        {sessions.map(({ id, version, nextSlot }) => {
          const venue = version.venue;
          const next = t("mobile.laterCustomer.next", { time: display.absolute(nextSlot.startsAt, venue.siteZone) });
          const price = display.price(version.price);
          const available = !nextSlot.placesLeft ? t("mobile.laterCustomer.full") : version.format === "private" ? t("mobile.laterCustomer.available") :
            t("mobile.laterCustomer.placesLeft", { count: nextSlot.placesLeft });
          const facts = [t("mobile.laterCustomer.minutes", { count: Math.round(version.durationMs / 60_000) }), t("mobile.laterCustomer.taughtIn", { language: display.language(version.language) }), venue.accessNote];
          return <Card key={id} accessibilityLabel={[version.title, price, venue.name, next, available, ...facts].join(", ")} onPress={() => onCard(id)}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <Copy variant="sectionTitle">{version.title}</Copy><Copy variant="label">{price}</Copy>
            </View>
            <Copy variant="supporting">{venue.name} · {venue.locality}</Copy>
            <Copy variant="label">{next} · {available}</Copy>
            <Copy variant="supporting">{facts.join(" · ")}</Copy>
          </Card>;
        })}
        {hasMore && onMore && <Button label={t("mobile.laterCustomer.more")} variant="neutral" onPress={onMore} />}
        {pageError && onRetry && <Button label={t("mobile.laterCustomer.retry")} variant="neutral" onPress={onRetry} />}
      </>}
  </Screen>;
}
