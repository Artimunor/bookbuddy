import { native } from "@bookbuddy/design-tokens";
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import { useBeaconTheme } from "../theme";
import { Glyph } from "./parts";

export type StampKind = "crew" | "attendance" | "photo" | "decision" | "system";

export type StampProps = {
  title: string;
  /** Use whole actor/role copy and format the time in the feed's zone at the call site. */
  attribution?: string;
  time: string;
  detail?: string;
} & (
  | { kind: Exclude<StampKind, "photo">; photo?: never }
  | { kind: "photo"; photo: { source: ImageSourcePropType; accessibilityLabel: string } }
) & (
  | { state?: "confirmed"; stateLabel?: never }
  | { state: "pending" | "rejected" | "corrected" | "retracted"; stateLabel: string }
);

const metrics = native.componentMetrics.stamp;
const marks: Record<StampKind, string> = { crew: "●", attendance: "⌖", photo: "▣", decision: "✓", system: "≋" };

export function Stamp({ title, attribution, time, detail, kind, photo, state = "confirmed", stateLabel }: StampProps) {
  const { color, type, space, radius, field } = useBeaconTheme();
  const pending = state === "pending";
  const negative = state === "rejected" || state === "retracted";
  const statusInk = pending ? color.attentionInk : negative ? color.criticalInk : state === "corrected" ? color.infoInk : color.ink;
  const glyphFill = pending ? color.attentionSoft : negative ? color.criticalSoft : state === "corrected" ? color.infoSoft : color.subtle;
  const mark = state === "corrected" ? "↺" : negative ? "×" : pending ? "…" : marks[kind];
  return (
    <View style={[styles.stamp, {
      backgroundColor: color.surface, borderColor: color.separator, borderRadius: radius.card,
      gap: space.grid[3], padding: space.grid[3], minHeight: native.ergonomics[field ? "field" : "standard"].rowMinHeight,
    }]}>
      <View style={[styles.tile, {
        backgroundColor: glyphFill, borderRadius: radius.smallTile, borderColor: statusInk,
        borderWidth: pending ? 1 : 0, borderStyle: pending ? "dashed" : "solid",
      }]}><Glyph mark={mark} color={statusInk} size={22} /></View>
      <View style={[styles.body, { gap: space.grid[1] }]}>
        <View style={[styles.heading, { columnGap: space.grid[2] }]}>
          <Text style={[type.label, styles.title, { color: color.ink }]}>{title}</Text>
          <Text style={[type.supporting, native.tabularNumbers, styles.time, { color: color.muted }]}>{time}</Text>
        </View>
        {attribution && <Text style={[type.supporting, { color: color.muted }]}>{attribution}</Text>}
        {detail && <Text style={[type.supporting, { color: color.ink }]}>{detail}</Text>}
        {stateLabel && <Text style={[type.supporting, { color: statusInk }]}>{stateLabel}</Text>}
        {photo && (
          <Image accessible accessibilityLabel={photo.accessibilityLabel} source={photo.source} style={[styles.photo, { borderRadius: radius.smallTile }]} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stamp: { borderWidth: 1, flexDirection: "row", alignItems: "flex-start" },
  tile: { width: metrics.glyphTileSize, height: metrics.glyphTileSize, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0 },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline" },
  title: { flexGrow: 1, flexShrink: 1 },
  time: { flexShrink: 1, maxWidth: "100%" },
  photo: { width: metrics.photoThumbnailSize, height: metrics.photoThumbnailSize },
});
