import { SymbolView } from "expo-symbols";
import type { ComponentProps } from "react";
import { View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useBeaconTheme } from "../theme";
import { Copy, controlMetrics } from "./shared";

const symbols = {
  now: { ios: "circle.fill", android: "radio_button_checked", web: "radio_button_checked" },
  bookings: { ios: "calendar", android: "calendar_today", web: "calendar_today" },
  jobs: { ios: "briefcase", android: "work", web: "work" },
  crew: { ios: "person.2", android: "groups", web: "groups" },
  shifts: { ios: "clock", android: "schedule", web: "schedule" },
  messages: { ios: "bubble.left", android: "chat_bubble_outline", web: "chat_bubble_outline" },
  people: { ios: "person.2", android: "group", web: "group" },
} as const satisfies Record<string, ComponentProps<typeof SymbolView>["name"]>;

type TabKind = keyof typeof symbols;
const fallbackGlyph: Record<TabKind, string> = { now: "⊙", bookings: "▦", jobs: "▤", crew: "♧", shifts: "◷", messages: "▱", people: "♧" };

export function BeaconTabIcon({ kind, focused }: { kind: TabKind; focused: boolean }) {
  const { color } = useBeaconTheme();
  const tint = focused ? color.ink : color.muted;
  return <SymbolView name={symbols[kind]} tintColor={tint} size={24} accessible={false} aria-hidden
    fallback={<Copy variant="label" aria-hidden style={{ color: tint }}>{fallbackGlyph[kind]}</Copy>} />;
}

export function BeaconTabLabel({ label, focused }: { label: string; focused: boolean }) {
  const { color, space } = useBeaconTheme();
  return <View style={{ alignItems: "center", gap: space.grid[1] }}>
    <Copy variant="caption" style={{ textAlign: "center", color: focused ? color.ink : color.muted, fontWeight: focused ? "700" : "600" }}>{label}</Copy>
    <View aria-hidden style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: focused ? color.ink : "transparent" }} />
  </View>;
}

export function beaconTab(kind: TabKind, label: string) {
  return {
    title: label,
    tabBarAccessibilityLabel: label,
    tabBarIcon: ({ focused }: { focused: boolean }) => <BeaconTabIcon kind={kind} focused={focused} />,
    tabBarLabel: ({ focused }: { focused: boolean }) => <BeaconTabLabel label={label} focused={focused} />,
  };
}

export function useBeaconTabOptions() {
  const { bottom } = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const { color, field, space, type } = useBeaconTheme();
  const height = Math.max(controlMetrics(field).rowMinHeight, 24 + space.grid[3] + Math.ceil(type.caption.lineHeight * fontScale * (fontScale >= 1.5 ? 2 : 1)) + 8);
  return {
    headerShown: false,
    tabBarLabelPosition: "below-icon" as const,
    tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.separator, height: height + bottom },
  };
}
