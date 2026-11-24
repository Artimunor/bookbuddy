import { getPlaceRoute, listPlacesRoute, type PlaceDetails, type PlaceSummary } from "@bookbuddy/api-contract";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useRemote } from "../../api";
import { useT } from "../../i18n";
import { Button, Card, Dock, Screen, SegmentedControl, TextField } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { requestDraftHref, type RequestDraft, useRequestDraft } from "../c-02/draft";
import { useOffline } from "../s-02/flow";

export default function RequestPlaceScreen() {
  const router = useRouter(); const { placeId, changed } = useLocalSearchParams<{ placeId?: string; changed?: string }>();
  const local = useRequestDraft(); const offline = useOffline(); const [cursor, setCursor] = useState<string | undefined>(); const t = useT();
  const list = useRemote(listPlacesRoute, { query: cursor ? { cursor } : {} });
  const detail = useRemote(getPlaceRoute, { params: { p: local.value.placeId } }, { enabled: !!local.value.placeId });
  const chosen = useRef(false);
  useEffect(() => {
    if (local.loaded && !local.value.pendingOperation && !chosen.current && placeId) { chosen.current = true; void local.change({ ...local.value, placeId, safeNote: "", step: "place" }).catch(() => {}); }
  }, [placeId, local.loaded, local.value, local.change]);
  useEffect(() => {
    if (local.loaded && !local.value.pendingOperation && !chosen.current && !placeId && !local.value.placeId && list.status === "ready" && list.data.places.length) {
      chosen.current = true; void local.change({ ...local.value, placeId: list.data.places[0]!.id }).catch(() => {});
    }
  }, [placeId, list.status, list.data, local.loaded, local.value, local.change]);
  if (!local.loaded) return <Screen title={t("mobile.request.placeTitle")}><Copy>{local.failed ? t("mobile.request.saveFailed") : t("mobile.request.loading")}</Copy></Screen>;
  if (local.value.pendingOperation) return <Screen title={t("mobile.request.placeTitle")}><Copy>{t("mobile.request.checking")}</Copy><Button label={t("mobile.request.review")} onPress={() => router.replace(requestDraftHref("review", local.draftId))} /></Screen>;
  return <PlaceRequestView draft={local.value} place={detail.data} places={list.data?.places ?? []} status={offline ? "offline" : list.status} saved={local.saved} failed={local.failed} warn={local.warn} changed={changed === "1"} onChange={d => { void local.change(d).catch(() => {}); }} onBack={() => router.back()} onNext={() => { void local.change({ ...local.value, step: "review" }).then(() => router.push(requestDraftHref("review", local.draftId))).catch(() => {}); }} onAdd={() => router.push(`/c/places/new?returnTo=request&draftId=${local.draftId}` as Href)} onRetry={() => { void list.refresh(); if (local.value.placeId) void detail.refresh(); }} onMore={list.data?.hasMore && list.data.cursor ? () => setCursor(list.data!.cursor!) : undefined} />;
}

type Status = "idle" | "loading" | "ready" | "error" | "offline";
export function PlaceRequestView({ draft, place, places, status, saved, failed, warn = false, changed = false, onChange, onBack, onNext, onAdd, onRetry, onMore }: { draft: RequestDraft; place: PlaceDetails | null; places: PlaceSummary[]; status: Status; saved: boolean; failed: boolean; warn?: boolean; changed?: boolean; onChange: (draft: RequestDraft) => void; onBack: () => void; onNext: () => void; onAdd: () => void; onRetry: () => void; onMore?: () => void }) {
  const t = useT(); const [picker, setPicker] = useState(false); const [confirm, setConfirm] = useState<string | null>(null); const [unsafe, setUnsafe] = useState(false);
  const area = status === "offline" ? t("mobile.request.areaOffline") : place?.state === "in_area" ? t("mobile.request.inArea") : place?.state === "out_of_area" ? t("mobile.request.outsideArea") : t("mobile.request.areaUnknown");
  const reason = !draft.placeId ? t("mobile.request.choosePlace") : place?.state === "out_of_area" ? area : draft.arrivalArrangement === "nobody" && !draft.safeNote.trim() ? t("mobile.request.noteRequired") : draft.arrivalArrangement === "someone_else" && !draft.arrivalContactName.trim() ? t("mobile.request.contactRequired") : t("mobile.request.notBooking");
  const valid = !!draft.placeId && place?.state !== "out_of_area" && (status === "offline" || !!place) && (draft.arrivalArrangement !== "nobody" || !!draft.safeNote.trim()) && (draft.arrivalArrangement !== "someone_else" || !!draft.arrivalContactName.trim());
  function select(id: string) { if (id !== draft.placeId && draft.safeNote) setConfirm(id); else { onChange({ ...draft, placeId: id }); setPicker(false); } }
  return <Screen title={t("mobile.request.placeTitle")} navigation={{ kind: "back", label: t("mobile.request.back"), onPress: onBack }} dock={<Dock context={reason} primary={{ label: t("mobile.request.review"), onPress: onNext, disabled: !valid }} />}>
    <Copy variant="supporting">{t("mobile.request.stepTwo")}</Copy><Copy variant="sectionTitle">{t("mobile.request.where")}</Copy>
    {changed && <Copy>{t("mobile.request.placeChanged")}</Copy>}{warn && <Copy>{t("mobile.request.expiryWarning")}</Copy>}
    {draft.placeId && <Card><Copy variant="sectionTitle">{place?.alias ?? draft.placeId}</Copy>{!!place?.address && <Copy>{place.address}</Copy>}<Copy>{area}</Copy>{!!place?.siteZone && <Copy variant="supporting">{place.siteZone}</Copy>}<Button variant="quiet" label={t("mobile.request.changePlace")} onPress={() => setPicker(!picker)} /></Card>}
    {(picker || !draft.placeId) && <Card>{places.map(p => <Button key={p.id} variant="neutral" label={p.alias} onPress={() => select(p.id)} />)}{onMore && <Button variant="quiet" label={t("mobile.customerHome.nextPage")} onPress={onMore} />}<Button variant="quiet" label={t("mobile.request.addPlace")} onPress={onAdd} /></Card>}
    {confirm && <Card><Copy>{t("mobile.request.changeClears")}</Copy><Button label={t("mobile.request.confirmChange")} onPress={() => { onChange({ ...draft, placeId: confirm, safeNote: "" }); setConfirm(null); setPicker(false); }} /><Button variant="quiet" label={t("mobile.request.cancel")} onPress={() => setConfirm(null)} /></Card>}
    {(status === "idle" || status === "loading") && <Copy>{t("mobile.request.loading")}</Copy>}{status === "error" && <><Copy>{t("mobile.request.placeError")}</Copy><Button variant="quiet" label={t("mobile.request.retry")} onPress={onRetry} /></>}
    <TextField label={t("mobile.request.access")} multiline maxLength={500} value={draft.safeNote} helper={t("mobile.request.noCodes")} error={unsafe ? t("mobile.request.codeWarning") : undefined} onChangeText={safeNote => { if (/\p{N}/u.test(safeNote)) { setUnsafe(true); return; } setUnsafe(false); onChange({ ...draft, safeNote }); }} />
    <SegmentedControl label={t("mobile.request.who")} value={draft.arrivalArrangement} options={[{ value: "nobody", label: t("mobile.request.nobody") }, { value: "requester", label: t("mobile.request.me") }, { value: "someone_else", label: t("mobile.request.someone") }]} onChange={arrivalArrangement => onChange({ ...draft, arrivalArrangement, arrivalContactName: arrivalArrangement === "someone_else" ? draft.arrivalContactName : "" })} />
    {draft.arrivalArrangement === "someone_else" && <TextField label={t("mobile.request.contact")} helper={t("mobile.request.contactHelp")} value={draft.arrivalContactName} maxLength={100} onChangeText={arrivalContactName => onChange({ ...draft, arrivalContactName })} />}
    {saved && <Copy variant="supporting">{status === "offline" ? t("mobile.request.savedOffline") : t("mobile.request.saved")}</Copy>}{failed && <Copy>{t("mobile.request.saveFailed")}</Copy>}
  </Screen>;
}
