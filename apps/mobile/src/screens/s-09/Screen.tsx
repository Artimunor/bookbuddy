import { notificationReadRoute, notificationsRoute, type NotificationProjection } from "@bookbuddy/api-contract";
import { useRouter, type Href } from "expo-router";
import { useState } from "react";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useCommand, useRemote } from "../../api";
import { useT, useFormat } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Screen, SegmentedControl, StatusBanner } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

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
  const t = useT(); const format = useFormat(); const { color, radius, space, field } = useBeaconTheme();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const unread = items.filter((item) => item.readAt === null);
  const filtered = filter === "unread" ? unread : items;
  const groups = new Map<string, { item: Row; time: string }[]>();
  for (const item of filtered) {
    const clock = format.siteTime(item.createdAt, zone);
    const date = clock.kind === "available" ? clock.site.date : "";
    const row = { item, time: clock.kind === "available" ? clock.site.time : "" };
    const group = groups.get(date);
    if (group) group.push(row);
    else groups.set(date, [row]);
  }
  const confirmedTime = confirmed == null ? null : format.twoClock(confirmed, zone, zone);
  const mark = t("mobile.notifications.markAll");
  return <Screen title={t("mobile.notifications.title")} navigation={{ kind: "back", label: t("mobile.notifications.back"), onPress: onBack }}
    trailing={<Button variant="navigation" glyph="✓✓" iconOnly label={mark} disabled={!unread.length || status === "offline" || busy} onPress={onMarkAll} />}>
    {status === "offline" && <StatusBanner state="offline" label={t("mobile.notifications.offline")} detail={confirmedTime?.kind === "available" ? `${confirmedTime.site.date} · ${confirmedTime.site.time} ${t("shared.time.viewerZone")}` : undefined} />}
    <SegmentedControl label={t("mobile.notifications.title")} value={filter} onChange={setFilter} options={[
      { value: "all", label: t("mobile.notifications.all") },
      { value: "unread", label: status === "ready" && unread.length ? t("mobile.notifications.unreadCount", { count: unread.length }) : t("mobile.notifications.unread") },
    ]} />
    {(status === "loading" || status === "idle") && <Copy>{t("mobile.notifications.loading")}</Copy>}
    {status === "error" && <Button variant="neutral" label={t("mobile.notifications.retry")} onPress={onRetry} />}
    {status !== "loading" && !filtered.length && <Copy>{t("mobile.notifications.empty")}</Copy>}
    {filtered.length > 0 && <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.notifications.viewerTimes")}</Copy>}
    {[...groups].map(([date, rows]) => <View key={date} style={{ gap: space.grid[2] }}>
      <Copy variant="sectionTitle">{date}</Copy>
      <Card dense>
        {rows.map(({ item, time }, index) => {
          const isOffer = item.kind === "cover_offer" || item.kind === "assignment_offer";
          const isMessage = item.kind === "message";
          const title = item.kind === "cover_offer" ? t("mobile.notifications.coverOffer")
            : item.kind === "assignment_offer" ? t("mobile.notifications.shiftOffer")
              : isMessage ? t("mobile.notifications.message") : t("mobile.notifications.update");
          const state = item.readAt === null ? t("mobile.notifications.new") : "";
          const icon = isOffer ? { ios: "calendar", android: "calendar_today", web: "calendar_today" } as const
            : isMessage ? { ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" } as const
              : { ios: "bell", android: "notifications", web: "notifications" } as const;
          return <Target key={item.id} accessibilityRole="button" accessibilityLabel={[title, time, state].filter(Boolean).join(" · ")}
            onPress={() => onOpen(item)} style={({ pressed }) => ({ flexDirection: "row", flexWrap: "wrap", alignItems: "center",
              gap: space.grid[2], minHeight: controlMetrics(field).rowMinHeight, paddingBottom: space.grid[2],
              backgroundColor: pressed ? color.subtle : color.surface, borderColor: color.separator, borderBottomWidth: index === rows.length - 1 ? 0 : 1 })}>
            <View aria-hidden style={{ backgroundColor: color.subtle, borderRadius: radius.smallTile, width: 32, height: 32, alignItems: "center", justifyContent: "center" }}>
              <SymbolView name={icon} tintColor={color.ink} size={20} />
            </View>
            <Copy variant="label" style={{ flexGrow: 1, flexShrink: 1 }}>{title}</Copy>
            {state && <Badge label={state} tone="info" />}
            <Copy variant="supporting" style={{ color: color.muted, fontVariant: ["tabular-nums"] }}>{time}</Copy>
          </Target>;
        })}
      </Card>
    </View>)}
    {hasPrevious && <Button variant="neutral" label={t("mobile.notifications.previous")} onPress={onPrevious} />}{hasNext && <Button variant="neutral" label={t("mobile.notifications.next")} onPress={onNext} />}
    <Copy variant="supporting" style={{ color: color.muted, textAlign: "center" }}>{t("mobile.notifications.nothingChanges")}</Copy>
  </Screen>;
}
