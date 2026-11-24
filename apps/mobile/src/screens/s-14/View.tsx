import { native } from "@bookbuddy/design-tokens";
import { SymbolView } from "expo-symbols";
import type { ComponentProps, ComponentRef, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, I18nManager, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useT } from "../../i18n";
import { mediaClock } from "../../media/time";
import { Button } from "../../ui/controls";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

type SourceIcon = ComponentProps<typeof SymbolView>["name"];
const sourceIcons = {
  camera: { ios: "camera", android: "photo_camera", web: "photo_camera" },
  library: { ios: "photo", android: "photo_library", web: "photo_library" },
  voice: { ios: "mic", android: "mic", web: "mic" },
} as const satisfies Record<string, SourceIcon>;

export function AttachPanel({ title, destination, onClose, closeDisabled, children, dock }: {
  title: string; destination: string; onClose: () => void; closeDisabled?: boolean; children: ReactNode; dock?: ReactNode;
}) {
  const t = useT();
  const { color, space, radius, scheme } = useBeaconTheme();
  const { height, fontScale } = useWindowDimensions();
  const scrollDock = height < 520 || fontScale >= 1.5;
  const heading = useRef<ComponentRef<typeof View>>(null);
  useEffect(() => {
    if (Platform.OS !== "web" && heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, "focus");
  }, []);
  return <View style={[styles.host, Platform.OS === "web" && { backgroundColor: native.scrim[scheme] }]}>
    <SafeAreaView accessibilityViewIsModal edges={["bottom", "left", "right"]} style={[styles.panel, {
      backgroundColor: color.raised, borderTopStartRadius: radius.sheetTop, borderTopEndRadius: radius.sheetTop,
    }]}>
      <View style={[styles.handle, { backgroundColor: color.outline }]} importantForAccessibility="no" />
      <View style={{ paddingHorizontal: space.contentInset, paddingVertical: space.grid[2], gap: space.grid[1] }}>
        <View style={[styles.header, { gap: space.grid[3] }]}>
          <View ref={heading} accessible accessibilityRole="header" accessibilityLabel={title} style={styles.flex}>
            <Copy accessible={false} variant="sectionTitle">{title}</Copy>
          </View>
          <Button label={t("shared.action.close")} glyph="×" iconOnly variant="neutral" onPress={onClose} disabled={closeDisabled} />
        </View>
        <Copy variant="supporting" style={{ color: color.muted }}>{destination}</Copy>
      </View>
      <ScrollView style={styles.body} contentContainerStyle={{ paddingHorizontal: space.contentInset, paddingBottom: space.grid[4], gap: space.grid[4] }}>
        {children}
        {scrollDock && dock}
      </ScrollView>
      {!scrollDock && dock}
    </SafeAreaView>
  </View>;
}

export function CaptureSourceRow({ name, title, description, onPress, disabled, denied, onSettings, first }: {
  name: keyof typeof sourceIcons; title: string; description: string; onPress: () => void;
  disabled: boolean; denied?: boolean; onSettings?: () => void; first?: boolean;
}) {
  const t = useT();
  const { color, radius, space, field } = useBeaconTheme();
  return <View style={{ borderTopColor: color.separator, borderTopWidth: first ? 0 : StyleSheet.hairlineWidth }}>
    <Target accessibilityRole="button" accessibilityLabel={title} accessibilityHint={description} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.source, {
        minHeight: Math.max(68, controlMetrics(field).rowMinHeight), paddingHorizontal: space.grid[4], paddingVertical: space.grid[2],
        gap: space.grid[3], backgroundColor: pressed ? color.subtle : color.surface,
      }]}>
      <View style={{ width: 32, height: 32, borderRadius: radius.pill, backgroundColor: color.subtle, justifyContent: "center", alignItems: "center" }}
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <SymbolView name={sourceIcons[name]} size={20} tintColor={color.ink} />
      </View>
      <View style={styles.flex}>
        <Copy variant="label">{title}</Copy>
        <Copy variant="supporting" style={{ color: denied ? color.criticalInk : color.muted }}>{description}</Copy>
      </View>
      <Copy accessible={false} importantForAccessibility="no" variant="sectionTitle">{I18nManager.isRTL ? "‹" : "›"}</Copy>
    </Target>
    {denied && onSettings && <View style={{ alignSelf: "flex-start", marginStart: space.grid[4] }}>
      <Button variant="quiet" label={t("mobile.media.openSettings")} onPress={onSettings} />
    </View>}
  </View>;
}

export function RecordingCard({ elapsedMs, samples }: { elapsedMs: number; samples: readonly number[] }) {
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const time = mediaClock(elapsedMs / 1000);
  return <View style={{ borderRadius: radius.card, borderWidth: 1, borderColor: color.separator, backgroundColor: color.surface,
    padding: space.grid[4], paddingVertical: space.grid[5], gap: space.grid[5] }}>
    <View style={[styles.header, { gap: space.grid[2], flexWrap: "wrap" }]}>
      <View style={[styles.header, { gap: space.grid[2] }]}>
        <View importantForAccessibility="no" style={{ backgroundColor: color.criticalInk, width: 12, height: 12, borderRadius: 6 }} />
        <Copy variant="label" style={{ color: color.criticalInk }}>{t("mobile.media.recording")}</Copy>
      </View>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.notShared")}</Copy>
    </View>
    <Copy variant="display" accessibilityLabel={t("mobile.media.elapsed", { time })}
      style={{ textAlign: "center", writingDirection: "ltr", fontVariant: ["tabular-nums"] }}>{time}</Copy>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.trace}>
      {samples.map((level, index) => <View key={index} style={{ height: 4 + 27 * level, flex: 1, maxWidth: 4, borderRadius: 3, backgroundColor: color.ink }} />)}
    </View>
  </View>;
}

export function RecordingDock({ onDiscard, onStop, busy }: { onDiscard: () => void; onStop: () => void; busy?: boolean }) {
  const t = useT();
  const { color, space } = useBeaconTheme();
  const { fontScale } = useWindowDimensions();
  return <View style={{ flexDirection: fontScale >= 1.5 ? "column" : "row", gap: space.grid[4], padding: space.contentInset,
    borderTopWidth: 1, borderTopColor: color.separator, backgroundColor: color.surface }}>
    <Button label={t("mobile.media.discard")} variant="destructive" onPress={onDiscard} disabled={busy} />
    <View style={styles.flex}><Button label={t("mobile.media.stopReview")} glyph="■" onPress={onStop} busy={busy} /></View>
  </View>;
}

const styles = StyleSheet.create({
  host: { flex: 1, justifyContent: "flex-end" },
  panel: { maxHeight: "100%", flexShrink: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  handle: { height: 5, width: 40, alignSelf: "center", borderRadius: 3, marginTop: 10 },
  body: { flexGrow: 0, flexShrink: 1 },
  source: { flexDirection: "row", alignItems: "center" },
  trace: { height: 36, flexDirection: "row", direction: "ltr", alignItems: "center", justifyContent: "space-between", gap: 3 },
});
