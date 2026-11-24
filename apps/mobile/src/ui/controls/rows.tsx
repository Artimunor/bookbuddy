import type { ReactNode } from "react";
import { I18nManager, Platform, StyleSheet, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Copy, Target, controlMetrics } from "./shared";

type RowContent = {
  label: string;
  description?: string;
  glyph?: string;
  accessibilityLabel?: string;
};

export type ListRowProps = RowContent & {
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
};

export function ListRow({ label, description, glyph, accessibilityLabel, trailing, onPress, disabled, selected }: ListRowProps) {
  const { color } = useBeaconTheme();
  const style = useRowStyle();
  const details = <Details label={label} description={description} glyph={glyph} />;
  if (!onPress) return <View style={style}>{details}{trailing}</View>;
  return (
    <Target
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, selected }}
      {...(Platform.OS === "web" ? { "aria-pressed": selected } : undefined)}
      style={({ pressed }) => [style, { backgroundColor: pressed ? color.subtle : selected ? color.brandSoft : color.surface }]}
    >
      {details}
      {trailing ?? <Copy variant="label" style={{ color: color.muted }} aria-hidden>{I18nManager.isRTL ? "‹" : "›"}</Copy>}
    </Target>
  );
}

export type SettingsRowProps = Omit<ListRowProps, "trailing"> & { value?: string };

export function SettingsRow({ value, ...props }: SettingsRowProps) {
  const { color } = useBeaconTheme();
  return <ListRow {...props} trailing={value ? <Copy variant="supporting" style={{ color: color.muted, maxWidth: "40%" }}>{value}</Copy> : undefined} />;
}

export type SwitchRowProps = RowContent & {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
};

export function SwitchRow({ label, description, glyph, accessibilityLabel, value, onValueChange, disabled }: SwitchRowProps) {
  const { color, field, radius } = useBeaconTheme();
  const style = useRowStyle();
  return (
    <Target
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [style, { backgroundColor: pressed ? color.subtle : color.surface }]}
    >
      <Details label={label} description={description} glyph={glyph} />
      <View aria-hidden pointerEvents="none" style={[
        styles.track, {
          borderRadius: radius.pill,
          borderColor: value ? color.brand : color.outline,
          borderWidth: controlMetrics(field).controlBorderWidth,
          backgroundColor: value ? color.brand : color.subtle,
          justifyContent: value ? "flex-end" : "flex-start",
        },
      ]}>
        <View style={[styles.thumb, { borderRadius: radius.pill, backgroundColor: value ? color.onBrand : color.outline }]} />
      </View>
    </Target>
  );
}

function Details({ label, description, glyph }: RowContent) {
  const { color, space } = useBeaconTheme();
  return (
    <>
      {!!glyph && <Copy variant="label" aria-hidden>{glyph}</Copy>}
      <View style={[styles.details, { gap: space.grid[1] }]}>
        <Copy variant="label">{label}</Copy>
        {!!description && <Copy variant="supporting" style={{ color: color.muted }}>{description}</Copy>}
      </View>
    </>
  );
}

function useRowStyle() {
  const { color, field, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  return [styles.row, {
    minHeight: metrics.rowMinHeight,
    gap: metrics.controlGap,
    paddingVertical: space.grid[2],
    paddingHorizontal: space.grid[4],
    borderBottomWidth: 1,
    borderBottomColor: color.separator,
    backgroundColor: color.surface,
  }];
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  details: { flex: 1, minWidth: 0 },
  track: { width: 48, height: 28, padding: 3, flexDirection: "row", alignItems: "center" },
  thumb: { width: 18, height: 18 },
});
