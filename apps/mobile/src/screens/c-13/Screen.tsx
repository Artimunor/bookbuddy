import { listPlacesRoute, type PlaceSummary } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useOffline } from "../s-02/flow";

export default function PlacesScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<{ search: string; cursors: string[] }>({ search: "", cursors: [] });
  useEffect(() => { const timer = setTimeout(() => setPage({ search: query.trim(), cursors: [] }), 300); return () => clearTimeout(timer); }, [query]);
  const cursor = page.cursors.at(-1);
  const remote = useRemote(listPlacesRoute, { query: { ...(page.search ? { q: page.search } : {}), ...(cursor ? { cursor } : {}) } });
  const offline = useOffline();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (offline) { wasOffline.current = true; return; }
    if (wasOffline.current) { wasOffline.current = false; void remote.refresh(); }
  }, [offline, remote.refresh]);
  return <PlacesView query={query} onQuery={setQuery} places={remote.data?.places ?? []} total={remote.data?.total ?? 0}
    status={remote.status} onRetry={() => { void remote.refresh(); }} onBack={() => router.back()}
    onOpen={(id) => router.push(`/c/places/${id}` as Href)} onAdd={() => router.push("/c/places/new" as Href)}
    onPrevious={page.cursors.length ? () => setPage((current) => ({ ...current, cursors: current.cursors.slice(0, -1) })) : undefined}
    onNext={remote.data?.hasMore && remote.data.cursor ? () => setPage((current) => ({ ...current, cursors: [...current.cursors, remote.data!.cursor!] })) : undefined} />;
}

export function PlacesView({ query, onQuery, places, total, status, onRetry, onBack, onOpen, onAdd, onPrevious, onNext }: {
  query: string; onQuery: (value: string) => void; places: PlaceSummary[]; total: number;
  status: "idle" | "loading" | "ready" | "error" | "offline"; onRetry: () => void; onBack: () => void; onOpen: (id: string) => void; onAdd: () => void;
  onPrevious?: () => void; onNext?: () => void;
}) {
  const t = useT();
  const ordered = [...places].sort((a, b) => Number(b.liveBookingCount > 0 || b.openBookingCount > 0) - Number(a.liveBookingCount > 0 || a.openBookingCount > 0) || a.alias.localeCompare(b.alias));
  return <Screen title={t("mobile.places.title")} navigation={{ kind: "back", label: t("mobile.places.back"), onPress: onBack }}
    dock={status !== "offline" ? <Dock primary={{ label: t("mobile.places.add"), onPress: onAdd }} /> : undefined}>
    {status === "ready" && <><Copy variant="supporting">{t("mobile.places.count", { count: total })}</Copy>
      <TextField label={t("mobile.places.search")} value={query} onChangeText={onQuery} maxLength={160} />
      {ordered.map((place) => <PlaceCard key={place.id} place={place} onOpen={() => onOpen(place.id)} />)}
      {!ordered.length && <><Copy variant="sectionTitle">{query ? t("mobile.places.noMatch") : t("mobile.places.empty")}</Copy>
        {!!query && <Button variant="quiet" label={t("mobile.places.clear")} onPress={() => onQuery("")} />}</>}
      <Copy variant="supporting">{t("mobile.places.separate")}</Copy></>}
      {onPrevious && <Button variant="quiet" label={t("mobile.places.previousPage")} onPress={onPrevious} />}
      {onNext && <Button variant="quiet" label={t("mobile.places.nextPage")} onPress={onNext} />}
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.places.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.places.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.places.unavailable")}</Copy><Button label={t("mobile.places.retry")} onPress={onRetry} /></>}
  </Screen>;
}

function PlaceCard({ place, onOpen }: { place: PlaceSummary; onOpen: () => void }) {
  const t = useT();
  const relationship = place.relationship === "owner" ? [t("mobile.places.owner"), place.viewerIsNamedApprover ? t("mobile.places.approver") : null].filter(Boolean).join(" · ")
    : place.ownerDisplayName ? t("mobile.places.managed", { name: place.ownerDisplayName }) : "";
  const booking = t("mobile.places.bookingsCount", { count: place.openBookingCount });
  return <Card onPress={onOpen} accessibilityLabel={[place.alias, place.areaName, place.siteZone, relationship, booking].filter(Boolean).join(", ")}>
    <Copy variant="sectionTitle">{place.alias}</Copy>
    <Copy variant="supporting">{[place.areaName, place.siteZone].filter(Boolean).join(" · ")}</Copy>
    {!!relationship && <Badge label={relationship} />}
    {place.relationship !== "owner" && !!place.namedApproverDisplayName && <Copy variant="supporting">{t("mobile.places.approves", { name: place.namedApproverDisplayName })}</Copy>}
    <View><Copy>{booking}</Copy></View>
  </Card>;
}
