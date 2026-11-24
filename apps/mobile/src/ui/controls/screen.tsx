import { native } from "@bookbuddy/design-tokens";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useBeaconTheme } from "../theme";
import { Button, type ControlAction } from "./actions";
import { Copy, Target, controlMetrics } from "./shared";

export type ScreenHeaderProps = {
  title: string;
  navigation?: ControlAction & { kind: "back" | "close" };
  identity?: ReactNode;
  bell?: ReactNode;
};

export function ScreenHeader({ title, navigation, identity, bell }: ScreenHeaderProps) {
  const { field, space } = useBeaconTheme();
  const back = navigation?.kind === "back";
  return (
    <View style={{ paddingHorizontal: space.contentInset, paddingVertical: space.grid[2], gap: space.grid[2] }}>
      {(navigation || identity || bell) && (
        <View style={[styles.header, { gap: controlMetrics(field).controlGap }]}>
          <View style={[styles.leading, { gap: controlMetrics(field).controlGap }]}>
            {navigation && (
              <View style={styles.navigation}>
                <Button {...navigation} variant={back ? "navigation" : "quiet"} arrow={back ? "back" : undefined} />
              </View>
            )}
            {identity}
          </View>
          {bell && <View style={styles.bell}>{bell}</View>}
        </View>
      )}
      <Copy accessibilityRole="header" variant={navigation ? "sectionTitle" : "pageTitle"}>{title}</Copy>
    </View>
  );
}

export type ScreenProps = ScreenHeaderProps & {
  children: ReactNode;
  dock?: ReactNode;
  /** Turn this off for a child that owns scrolling (e.g. a FlatList). */
  scroll?: boolean;
};

export function Screen({ children, dock, scroll = true, ...header }: ScreenProps) {
  const { color, field, space } = useBeaconTheme();
  const { height, fontScale } = useWindowDimensions();
  const body = { padding: space.contentInset, gap: controlMetrics(field).controlGap };
  const scrollDock = scroll && (height < 520 || fontScale >= 1.5);
  const footer = (
    <SafeAreaView edges={["bottom"]} style={{ backgroundColor: dock ? color.surface : color.canvas }}>
      {dock}
    </SafeAreaView>
  );
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.fill, { backgroundColor: color.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>
        {scroll ? (
          <ScrollView style={styles.fill} keyboardShouldPersistTaps="handled">
            <ScreenHeader {...header} />
            <View style={body}>{children}</View>
            {scrollDock && footer}
          </ScrollView>
        ) : (
          <>
            <ScreenHeader {...header} />
            <View style={styles.fill}>{children}</View>
          </>
        )}
        {!scrollDock && footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export type IdentityChipProps = {
  initials: string;
  name: string;
  context: string;
  status?: string;
  person?: "personA" | "personB" | "personC" | "personD";
  accessibilityLabel?: string;
  onPress: () => void;
};

export function IdentityChip({ initials, name, context, status, person = "personA", accessibilityLabel, onPress }: IdentityChipProps) {
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  const avatarSize = native.componentMetrics.crewDots.avatarSize;
  return (
    <Target
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [name, context, status].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => [styles.identity, {
        minHeight: metrics.rowMinHeight,
        paddingStart: space.grid[2],
        paddingEnd: space.grid[4],
        paddingVertical: space.grid[1],
        gap: space.grid[3],
        borderRadius: radius.pill,
        borderColor: color.outline,
        borderWidth: metrics.controlBorderWidth,
        backgroundColor: pressed ? color.subtle : color.surface,
      }]}
    >
      <View style={[styles.avatar, { minWidth: avatarSize, minHeight: avatarSize, borderRadius: radius.pill, backgroundColor: color[person] }]}>
        <Copy accessible={false} variant="caption">{initials}</Copy>
      </View>
      <View style={styles.leading}>
        <Copy variant="label">{name}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>{context}</Copy>
        {!!status && <Copy variant="supporting" style={{ color: color.attentionInk }}>{status}</Copy>}
      </View>
    </Target>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bell: { flexShrink: 1, maxWidth: "40%" },
  leading: { flexShrink: 1, minWidth: 0 },
  navigation: { alignSelf: "flex-start", maxWidth: "100%" },
  identity: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", maxWidth: "100%" },
  avatar: { alignItems: "center", justifyContent: "center", padding: 4 },
});
