import { native } from "@bookbuddy/design-tokens";
import { StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { DirectedText } from "./parts";

export type TwoClockProps = {
  siteTime: string;
  siteZone: string;
  /** Supply only when enabled and the zones differ; include the viewer date if it differs. */
  viewerLine?: string;
  size?: "standard" | "hero";
};

export function TwoClock({ siteTime, siteZone, viewerLine, size = "standard" }: TwoClockProps) {
  const { color, type, space } = useBeaconTheme();
  const hero = size === "hero";
  return (
    <View style={{ gap: space.grid[1] }}>
      <View style={hero ? undefined : [styles.row, { gap: space.grid[1] }]}>
        <DirectedText dir="ltr" style={[hero ? type.display : type.label, native.tabularNumbers, styles.time, { color: color.ink }]}>{siteTime}</DirectedText>
        <Text style={[type.supporting, styles.time, { color: color.muted }]}>{siteZone}</Text>
      </View>
      {viewerLine && <Text style={[type.supporting, native.tabularNumbers, { color: color.muted }]}>{viewerLine}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" },
  time: { alignSelf: "flex-start", flexShrink: 1, maxWidth: "100%" },
});
