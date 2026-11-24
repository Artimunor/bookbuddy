import { notificationReadRoute, notificationsRoute, type NotificationProjection } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useT, useFormat } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Screen } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";

type Row = Omit<NotificationProjection, "linkToken"> & { linkToken?: NotificationProjection["linkToken"] };
export default function NotificationsScreen() {
  const router = useRouter(); const { session } = useSession(); const contextId = session?.activeContext?.contextId;
  const [cursor, setCursor] = useState<string>(); const [stack, setStack] = useState<(string | undefined)[]>([]);
  const remote = useRemote(notificationsRoute, { query: { contextId: contextId!, ...(cursor ? { cursor } : {}) } }, { enabled: !!contextId, cache: { kind: "notification" } });
  const read = useCommand(notificationReadRoute);
  const items = remote.data?.items ?? [];
  return <NotificationsView items={items} status={remote.status} confirmed={remote.lastConfirmedAt} hasNext={remote.data?.page.hasMore ?? false} hasPrevious={stack.length > 0}
    busy={read.state === "sending" || read.state === "checking"}
    onBack={() => router.canGoBack() ? router.back() : router.replace("/you" as Href)}
    onOpen={(item) => { if (item.linkToken && remote.status !== "offline") router.push({ pathname: "/l/[opaque]", params: { opaque: item.linkToken, notificationId: item.id } } as Href); else router.push("/help" as Href); }}
    onMarkAll={() => { const first = items[0]; if (!contextId || !first || remote.status === "offline") return; void read.run({ body: { contextId, payload: { mode: "all", through: { id: first.id, createdAt: first.createdAt } } } }).then((result) => { if (result.ok && result.data.status !== "rejected") void remote.refresh(); }); }}
    onNext={() => { const next = remote.data?.page.cursor; if (next) { setStack([...stack, cursor]); setCursor(next); } }}
    onPrevious={() => { setCursor(stack.at(-1)); setStack(stack.slice(0, -1)); }} onRetry={() => { void remote.refresh(); }} />;
}

export function NotificationsView({ items, status, confirmed, hasNext = false, hasPrevious = false, busy = false, onBack, onOpen, onMarkAll, onNext, onPrevious, onRetry }: {
  items: Row[]; status: string; confirmed: number | null; hasNext?: boolean; hasPrevious?: boolean; busy?: boolean;
  onBack: () => void; onOpen: (item: Row) => void; onMarkAll: () => void; onNext: () => void; onPrevious: () => void; onRetry: () => void;
}) {
  const t = useT(); const format = useFormat(); const [unread, setUnread] = useState(false);
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const filtered = unread ? items.filter((item) => item.readAt === null) : items;
  const groups = new Map<string, Row[]>();
  for (const item of filtered) { const clock = format.siteTime(item.createdAt, viewerZone); const date = clock.kind === "available" ? clock.site.date : ""; groups.set(date, [...(groups.get(date) ?? []), item]); }
  const confirmedClock = confirmed ? format.siteTime(confirmed, viewerZone) : null;
  const label = (item: Row) => item.kind === "cover_offer" ? t("mobile.notifications.coverOffer") : item.kind === "assignment_offer" ? t("mobile.notifications.shiftOffer") : t("mobile.notifications.update");
  return <Screen title={t("mobile.notifications.title")} navigation={{ kind: "back", label: t("mobile.notifications.back"), onPress: onBack }}>
    {status === "offline" && <Copy>{t("mobile.notifications.offline")}{confirmedClock?.kind === "available" ? ` · ${confirmedClock.siteTime}` : ""}</Copy>}
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Button variant={!unread ? "primary" : "neutral"} label={t("mobile.notifications.all")} onPress={() => setUnread(false)} /><Button variant={unread ? "primary" : "neutral"} label={t("mobile.notifications.unread")} onPress={() => setUnread(true)} /><Button variant="quiet" label={t("mobile.notifications.markAll")} disabled={!items.some((item) => item.readAt === null) || status === "offline" || busy} onPress={onMarkAll} /></View>
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.notifications.loading")}</Copy>}
    {status === "error" && <Button variant="neutral" label={t("mobile.notifications.retry")} onPress={onRetry} />}
    {status !== "loading" && !filtered.length && <Copy>{t("mobile.notifications.empty")}</Copy>}
    {[...groups].map(([date, rows]) => <View key={date} style={{ gap: 10 }}><Copy variant="label">{date}</Copy>{rows.map((item) => { const clock = format.siteTime(item.createdAt, viewerZone); const time = clock.kind === "available" ? clock.site.time : ""; const title = label(item); const state = item.readAt === null ? t("mobile.notifications.new") : ""; return <Card key={item.id} onPress={() => onOpen(item)} accessibilityLabel={[title, time, state].filter(Boolean).join(", ")}><View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}><Copy variant="sectionTitle" style={{ flexGrow: 1, flexShrink: 1 }}>{title}</Copy>{!!state && <Badge label={state} tone="info" />}</View><Copy variant="supporting">{time}</Copy></Card>; })}</View>)}
    {hasPrevious && <Button variant="neutral" label={t("mobile.notifications.previous")} onPress={onPrevious} />}{hasNext && <Button variant="neutral" label={t("mobile.notifications.next")} onPress={onNext} />}
    <Copy variant="supporting">{t("mobile.notifications.nothingChanges")}</Copy>
  </Screen>;
}
