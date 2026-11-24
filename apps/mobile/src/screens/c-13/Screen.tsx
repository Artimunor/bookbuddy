import { listPlacesRoute, type PlaceSummary } from "@bookbuddy/api-contract";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { I18nManager, View } from "react-native";
import { useRemote } from "../../api";
import { useLocale, useT } from "../../i18n";
import { Badge, Button, Card, Dock, Screen, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { useOffline } from "../s-02/flow";
import { usePlaceLocationLabel } from "./location";

export default function PlacesScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
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
  if (from === "you" && !query && !page.search && !cursor && !offline && remote.status === "ready" && remote.data.total === 1) {
    const place = remote.data.places[0];
    if (place) return <Redirect href={{ pathname: "/c/places/[placeId]", params: { placeId: place.id } }} />;
  }
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
  const { locale } = useLocale();
  const { color } = useBeaconTheme();
  const locationLabel = usePlaceLocationLabel();
  const now = Date.now();
  const ordered = [...places].sort((a, b) => Number(b.liveBookingCount > 0 || b.openBookingCount > 0) - Number(a.liveBookingCount > 0 || a.openBookingCount > 0) || a.alias.localeCompare(b.alias, locale));
  return <Screen title={t("mobile.places.title")} subtitle={status === "ready" ? t("mobile.places.count", { count: total }) : undefined}
    navigation={{ kind: "back", label: t("mobile.places.back"), onPress: onBack }}
    dock={status !== "offline" ? <Dock primary={{ glyph: "+", label: t("mobile.places.add"), onPress: onAdd }} /> : undefined}>
    {status === "ready" && <>
      <TextField label={t("mobile.places.search")} value={query} onChangeText={onQuery} maxLength={160} returnKeyType="search" />
      {ordered.map((place) => <PlaceCard key={place.id} place={place} location={locationLabel(place.areaName, place.siteZone, now)} onOpen={() => onOpen(place.id)} />)}
      {!ordered.length && <><Copy variant="sectionTitle">{query ? t("mobile.places.noMatch") : t("mobile.places.empty")}</Copy>
        {!!query && <Button variant="quiet" label={t("mobile.places.clear")} onPress={() => onQuery("")} />}</>}
      <Copy variant="supporting" style={{ color: color.muted, textAlign: "center" }}>{t("mobile.places.separate")}</Copy></>}
      {onPrevious && <Button variant="quiet" label={t("mobile.places.previousPage")} onPress={onPrevious} />}
      {onNext && <Button variant="quiet" label={t("mobile.places.nextPage")} onPress={onNext} />}
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.places.loading")}</Copy>}
    {status === "offline" && <Copy>{t("mobile.places.offline")}</Copy>}
    {status === "error" && <><Copy>{t("mobile.places.unavailable")}</Copy><Button label={t("mobile.places.retry")} onPress={onRetry} /></>}
  </Screen>;
}

function PlaceCard({ place, location, onOpen }: { place: PlaceSummary; location: string; onOpen: () => void }) {
  const t = useT();
  const { color, radius, space } = useBeaconTheme();
  const relationship = place.relationship === "owner" ? (place.viewerIsNamedApprover ? t("mobile.places.ownerApprover") : t("mobile.places.owner"))
    : place.ownerDisplayName ? t("mobile.places.managed", { name: place.ownerDisplayName }) : "";
  const approver = place.relationship !== "owner" && place.namedApproverDisplayName
    ? t("mobile.places.approves", { name: place.namedApproverDisplayName }) : null;
  const booking = t("mobile.places.bookingsCount", { count: place.openBookingCount });
  return <Card dense onPress={onOpen} accessibilityLabel={[place.alias, location, relationship, approver, booking].filter(Boolean).join(", ")}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.grid[3] }}>
      <View aria-hidden style={{ backgroundColor: color.subtle, width: 32, height: 32, borderRadius: radius.smallTile, alignItems: "center", justifyContent: "center" }}>
        <Copy variant="sectionTitle" aria-hidden>⌂</Copy>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Copy variant="label">{place.alias}</Copy>
        {!!location && <Copy variant="supporting" style={{ color: color.muted }}>{location}</Copy>}
      </View>
      <Copy aria-hidden variant="label" style={{ color: color.muted }}>{I18nManager.isRTL ? "‹" : "›"}</Copy>
    </View>
    {!!relationship && <Badge tone={place.relationship === "owner" ? "info" : "neutral"} label={relationship} />}
    {!!approver && <Copy variant="supporting" style={{ color: color.muted }}>{approver}</Copy>}
    <Copy variant="supporting">{booking}</Copy>
  </Card>;
}
