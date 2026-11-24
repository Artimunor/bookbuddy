import { idSchema } from "@bookbuddy/api-contract";
import { Redirect, useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useFormat, useT } from "../../i18n";
import { useSession } from "../../session";
import { Badge, Button, Card, Dialog, Dock, Screen } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { OfferClock } from "../../ui/live/OfferClock";
import { useBeaconTheme } from "../../ui/theme";

const minute = 60_000;
type Match = { name: string; initials: string; languages: string };
export type PoolExample = {
  reference: string; task: string; skill: string; language: string; area: string; business: string; customer: string;
  zone: string; startsAt: number; endsAt: number; replyBy: number; now: number;
  matches: readonly Match[];
};

export default function VettedPoolScreen() {
  const { gapId } = useLocalSearchParams<{ gapId: string }>();
  const { session, status } = useSession();
  const router = useRouter();
  if (process.env.EXPO_PUBLIC_VETTED_POOL_CAPABILITY !== "1" || process.env.EXPO_PUBLIC_VETTED_POOL_LEGAL_CLEARANCE !== "1") {
    return <Redirect href={"/help?reason=removed" as Href} />;
  }
  if (status === "loading") return null;
  if (session?.activeContext?.role !== "foreman" || !idSchema.safeParse(gapId).success) return <Redirect href={"/help?reason=removed" as Href} />;
  return <VettedPoolView onBack={() => router.canGoBack() ? router.back() : router.replace("/f/now" as Href)} />;
}

export function VettedPoolView({ example, initial = "matches", onBack }: {
  example?: PoolExample; initial?: "matches" | "no-match" | "offers-out"; onBack: () => void;
}) {
  const t = useT();
  const format = useFormat();
  const { color, field, space, radius } = useBeaconTheme();
  const [selection, setSelection] = useState(() => example?.matches.map(match => match.name) ?? []);
  const [phase, setPhase] = useState<"matches" | "no-match" | "review" | "offers-out">(initial);
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [replyBy, setReplyBy] = useState(example?.replyBy ?? 0);
  const back = { kind: "back" as const, label: t("shared.action.back"), onPress: onBack };
  const title = t("mobile.vettedPool.title");
  const later = t("mobile.vettedPool.later");
  if (!example) return <Screen title={title} navigation={back}><Badge label={later} tone="info" /><Copy>{t("mobile.vettedPool.notConnected")}</Copy></Screen>;
  const time = (at: number) => {
    const stamp = format.siteTime(at, example.zone);
    return stamp.kind === "available" ? stamp.site.time : "";
  };
  const zone = format.siteTime(replyBy, example.zone);
  const deadline = t("mobile.vettedPool.replyBy", { time: time(replyBy), zone: zone.kind === "available" ? format.zoneLabel(example.zone, zone.site) : "" });
  const offerAction = t("mobile.vettedPool.send", { count: selection.length });
  const noMatch = phase === "no-match";
  const locked = phase === "offers-out" || phase === "review";
  const matches = phase === "offers-out" ? example.matches.filter(match => selection.includes(match.name)) : example.matches;
  const rules = [example.skill, t("mobile.vettedPool.briefing", { language: example.language }),
    t("mobile.vettedPool.freeWindow", { start: time(example.startsAt), end: time(example.endsAt) }), example.area,
    t("mobile.vettedPool.eligible"), t("mobile.vettedPool.approved")];
  const accountable = t("mobile.vettedPool.accountable", { business: example.business, customer: example.customer });
  const dock = <Dock context={phase === "offers-out" ? deadline : noMatch ? t("mobile.vettedPool.fixedConditions") : t("mobile.vettedPool.reservation")}
    primary={noMatch ? { label: t("mobile.vettedPool.backToNewVisit"), onPress: onBack }
      : phase === "offers-out" ? { label: t("mobile.vettedPool.offersOut"), onPress: onBack, disabled: true }
        : { label: offerAction, disabled: selection.length === 0 || locked, live: true, onPress: () => { setEditingDeadline(false); setPhase("review"); } }} />;
  return <Screen title={title} subtitle={`${example.reference} · ${example.task}`} navigation={back} trailing={<Badge label={later} tone="info" />} dock={dock}>
    <View style={{ backgroundColor: color.infoSoft, borderRadius: radius.card, padding: space.cardPadding, gap: space.grid[1] }}>
      <Copy variant="label" style={{ color: color.infoInk }}>{t("mobile.vettedPool.notAtLaunch")}</Copy>
      <Copy variant="supporting" style={{ color: color.infoInk }}>{t("mobile.vettedPool.clearance")}</Copy>
    </View>
    <Card><View style={{ flexDirection: "row", gap: space.grid[2], justifyContent: "space-between" }}>
      <View aria-hidden pointerEvents="none" style={{ position: "absolute", top: 10, start: 12, end: 12, height: 4, backgroundColor: color.subtle }}>
        <View style={{ width: "50%", height: 4, backgroundColor: color.ink }} />
      </View>
      {[t("mobile.vettedPool.crewDone"), title, t("mobile.vettedPool.newVisit")].map((label, index) => <View key={label} style={{ flex: 1, alignItems: index === 0 ? "flex-start" : index === 2 ? "flex-end" : "center", gap: space.grid[1] }}>
        <View aria-hidden style={{ alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 12, backgroundColor: index === 2 ? color.subtle : color.ink }}>
          <Copy variant="caption" style={{ color: index === 2 ? color.ink : color.surface }}>{index === 0 ? "×" : index + 1}</Copy>
        </View>
        <Copy variant="caption">{label}</Copy>
      </View>)}
    </View></Card>
    <Copy variant="label" accessibilityRole="header">{t("mobile.vettedPool.requirements")}</Copy>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.grid[2] }}>
      {rules.map(rule => <View key={rule} style={{ backgroundColor: color.subtle, borderRadius: radius.pill, paddingHorizontal: space.grid[3], paddingVertical: space.grid[2] }}><Copy variant="caption">{rule}</Copy></View>)}
    </View>
    {phase === "offers-out" && <OfferClock state="running" remaining={t("mobile.cover.shortMinutes", { count: Math.max(0, Math.ceil((replyBy - example.now) / minute)) })} fraction={Math.max(0, Math.min(1, (replyBy - example.now) / (15 * minute)))} deadline={deadline} />}
    {noMatch ? <Card><Copy variant="sectionTitle">{t("mobile.vettedPool.noMatch")}</Copy><Copy>{t("mobile.vettedPool.lastCondition")}</Copy></Card>
      : matches.map((match, index) => {
        const checked = selection.includes(match.name);
        return <Target key={match.name} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: locked }} disabled={locked}
          onPress={() => setSelection(current => checked ? current.filter(name => name !== match.name) : current.length < 3 ? [...current, match.name] : current)}
          style={{ borderColor: checked ? color.ink : color.separator, borderWidth: checked ? 2 : 1, borderRadius: radius.card,
            minHeight: controlMetrics(field).rowMinHeight, padding: space.grid[3], gap: space.grid[field ? 4 : 3], alignItems: "center", flexDirection: "row", backgroundColor: color.surface }}>
          <View aria-hidden style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderStyle: "dashed", borderColor: color.outline,
            alignItems: "center", justifyContent: "center", backgroundColor: index % 2 ? color.personC : color.personA }}><Copy variant="label">{match.initials}</Copy></View>
          <View style={{ flex: 1 }}><Copy variant="label">{match.name}</Copy><Copy variant="supporting">{example.skill} · {match.languages}</Copy>
            <Copy variant="supporting" style={{ color: color.successInk }}>{t("mobile.vettedPool.approved")} · {example.area}</Copy>
            {phase === "offers-out" && <Copy variant="caption">{t("mobile.cover.offered")}</Copy>}
          </View>{phase !== "offers-out" && <Copy aria-hidden variant="label">{checked ? "✓" : "○"}</Copy>}
        </Target>;
      })}
    {!noMatch && <><View style={{ backgroundColor: color.subtle, borderRadius: radius.card, paddingHorizontal: space.grid[3], minHeight: 48, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
      <Copy variant="supporting">{deadline}</Copy>{!locked && <Button variant="navigation" label={t("mobile.vettedPool.change")} onPress={() => setEditingDeadline(value => !value)} />}
    </View>
    {editingDeadline && <Card><Button variant="quiet" label={t("mobile.vettedPool.earlier")} disabled={replyBy - 5 * minute < example.now + 5 * minute} onPress={() => setReplyBy(value => value - 5 * minute)} />
      <Button variant="quiet" label={t("mobile.vettedPool.laterDeadline")} disabled={replyBy + 5 * minute > example.startsAt - 5 * minute} onPress={() => setReplyBy(value => value + 5 * minute)} /></Card>}
    <Copy variant="supporting" style={{ textAlign: "center", color: color.muted }}>{accountable}</Copy></>}
    <Dialog visible={phase === "review"} title={t("mobile.vettedPool.review")} closeLabel={t("shared.action.close")} onClose={() => setPhase("matches")}
      cancel={{ label: t("shared.action.back"), onPress: () => setPhase("matches") }}
      confirm={{ label: offerAction, onPress: () => setPhase("offers-out") }}>
      <Copy>{selection.join(", ")}</Copy><Copy>{deadline} · {example.area}</Copy><Copy>{accountable}</Copy>
    </Dialog>
  </Screen>;
}
