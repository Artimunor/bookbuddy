import { StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Glyph } from "./parts";

export type HoldBannerProps = { label: string } & (
  | { state: "briefingRequired" | "awaitingAcknowledgement"; blocked: string; action: string }
  | { state: "cleared" | "superseded"; detail?: string; blocked?: never; action?: never }
);

export function HoldBanner(props: HoldBannerProps) {
  const { color, type, space, radius, field } = useBeaconTheme();
  const cleared = props.state === "cleared";
  const superseded = props.state === "superseded";
  const fill = cleared ? color.successSoft : superseded ? color.subtle : color.attentionSoft;
  const ink = cleared ? color.successInk : superseded ? color.ink : color.attentionInk;
  return (
    <View role="status" accessibilityLiveRegion="polite" aria-live="polite" style={[styles.row, {
      backgroundColor: fill, borderColor: ink, borderWidth: field ? 2 : 1, borderRadius: radius.card,
      padding: space.cardPadding, gap: space.grid[field ? 4 : 3],
    }]}>
      <Glyph mark={cleared ? "✓" : superseded ? "↔" : "✋︎"} size={24} color={ink} />
      <View style={[styles.copy, { gap: space.grid[1] }]}>
        <Text style={[type.label, { color: ink }]}>{props.label}</Text>
        {"detail" in props && props.detail && <Text style={[type.body, { color: ink }]}>{props.detail}</Text>}
        {props.blocked && <Text style={[type.body, { color: ink }]}>{props.blocked}</Text>}
        {props.action && <Text style={[type.supporting, { color: ink }]}>{props.action}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  copy: { flex: 1, minWidth: 0 },
});
