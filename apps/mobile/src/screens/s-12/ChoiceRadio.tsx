import { View } from "react-native";
import { Copy, Target, controlMetrics } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

export function ChoiceRadio({ label, description, marker, accessibilityLabel, selected, disabled, pill, onPress }: {
  label: string;
  description?: string;
  marker?: string;
  accessibilityLabel?: string;
  selected: boolean;
  disabled?: boolean;
  pill?: boolean;
  onPress: () => void;
}) {
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  const fill = pill && selected;
  return <Target
    accessibilityRole="radio" accessibilityLabel={accessibilityLabel ?? [label, description].filter(Boolean).join(", ")}
    accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled}
    onPress={() => { if (!selected) onPress(); }}
    style={({ pressed }) => ({
      minHeight: metrics.rowMinHeight, maxWidth: "100%", flexGrow: pill ? 1 : 0,
      flexDirection: "row", alignItems: "center", gap: space.grid[3],
      paddingHorizontal: space.grid[4], paddingVertical: space.grid[2],
      borderRadius: pill ? radius.pill : radius.card, borderWidth: metrics.controlBorderWidth,
      borderColor: selected ? color.brand : color.outline,
      backgroundColor: fill ? color.brand : selected ? color.brandSoft : pressed ? color.subtle : color.surface,
    })}>
    <View style={{ flex: 1, minWidth: 0 }}>
      <Copy variant="label" style={{ color: fill ? color.onBrand : color.ink, textAlign: pill ? "center" : "auto" }}>
        {fill ? `✓ ${label}` : label}
      </Copy>
      {!!description && <Copy variant="supporting" style={{ color: color.muted }}>{description}</Copy>}
      {!!marker && <Copy variant="caption" style={{ color: color.muted }}>{marker}</Copy>}
    </View>
    {!pill && <View aria-hidden style={{
      borderWidth: 2, borderColor: selected ? color.brand : color.outline, borderRadius: radius.pill,
      width: 22, height: 22, justifyContent: "center", alignItems: "center",
      backgroundColor: selected ? color.brand : color.surface,
    }}>{selected && <Copy variant="caption" style={{ color: color.onBrand }}>✓</Copy>}</View>}
  </Target>;
}
