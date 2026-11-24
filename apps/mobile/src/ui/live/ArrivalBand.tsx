import { StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Stamp, type StampProps } from "./Stamp";
import { TwoClock, type TwoClockProps } from "./TwoClock";
import { Glyph } from "./parts";

export type ArrivalBandProps =
  | { state: "arrived"; checkIn: StampProps & { kind: "attendance" } }
  | {
    state: "window" | "onTheWay" | "dueNow" | "noUpdateSince";
    label: string;
    time: Omit<TwoClockProps, "size">;
    provenance?: string;
    /** A localised estimate, not a replacement for the band. */
    estimate?: string;
  };

const marks = { window: "◷", onTheWay: "»", dueNow: "!", noUpdateSince: "○" } as const;

export function ArrivalBand(props: ArrivalBandProps) {
  const { color, type, space, radius } = useBeaconTheme();
  if (props.state === "arrived") return <Stamp {...props.checkIn} />;

  const attention = props.state === "noUpdateSince" || props.state === "dueNow";
  const headingColor = attention ? color.attentionInk : props.state === "onTheWay" ? color.infoInk : color.ink;
  return (
    <View style={{
      borderWidth: 1, borderRadius: radius.card, borderColor: attention ? headingColor : color.separator,
      backgroundColor: attention ? color.attentionSoft : color.surface, padding: space.cardPadding, gap: space.grid[2],
    }}>
      <View style={[styles.heading, { gap: space.grid[2] }]}>
        <Glyph mark={marks[props.state]} size={20} color={headingColor} />
        <Text role="heading" style={[type.label, styles.label, { color: headingColor }]}>{props.label}</Text>
      </View>
      <TwoClock {...props.time} size="hero" />
      {props.estimate && props.state === "onTheWay" && <Text style={[type.supporting, { color: headingColor }]}>{props.estimate}</Text>}
      {props.provenance && <Text style={[type.supporting, { color: attention ? headingColor : color.muted }]}>{props.provenance}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "center" },
  label: { flex: 1 },
});
