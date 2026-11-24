import { native } from "@bookbuddy/design-tokens";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { CrewDots, type CrewDotsProps } from "./CrewDots";
import { JobLine, type JobLineProps, type JobLineStage } from "./JobLine";
import { decorative, DirectedText, Glyph } from "./parts";

export type LiveCapsuleState = "crewConfirmed" | "onTheWay" | "onSite" | "working" | "coverBeingArranged" |
  "crewChanged" | "noUpdateSince" | "finished" | "quiet" | "paused";

export type LiveCapsuleProps = {
  size?: "hero" | "card" | "pill";
  state: LiveCapsuleState;
  pulse?: boolean;
  stateLabel: string;
  source: string;
  reference?: string;
  time?: string;
  zoneLine?: string;
  estimate?: string;
  provenance: string;
  /** A single sentence with state, time and zone, and provenance. */
  accessibilityLabel: string;
  line?: JobLineStage & Pick<JobLineProps, "accessibilityLabel" | "compact" | "status">;
  crew?: CrewDotsProps;
  /** Glance surfaces open the live record. Omit on the live detail itself. */
  onPress?: () => void;
};

const metrics = native.componentMetrics.liveCapsule;
const marks: Record<LiveCapsuleState, string> = {
  crewConfirmed: "✓", onTheWay: "»", onSite: "⌖", working: "●", coverBeingArranged: "…",
  crewChanged: "↔", noUpdateSince: "○", finished: "✓", quiet: "○", paused: "Ⅱ",
};

export function LiveCapsule({
  size = "card", state, pulse, stateLabel, source, reference, time, zoneLine, estimate, provenance, accessibilityLabel, line, crew, onPress,
}: LiveCapsuleProps) {
  const { scheme, field, color, type, space } = useBeaconTheme();
  const [focused, setFocused] = useState(false);
  const polarity = native.liveCapsule[scheme][field ? "field" : "standard"];
  const activity = state === "finished" ? "finished"
    : state === "noUpdateSince" || state === "quiet" || state === "paused" || state === "coverBeingArranged" ? "quiet"
    : "live";
  const pill = size === "pill";
  const lineSurface = field ? "fieldCapsule" : "capsule";
  const accent = activity === "live" ? polarity.accent : polarity.text.color;
  const baseStyle = [polarity.surface, {
    borderRadius: pill ? metrics.pillRadius : metrics.radius,
    paddingHorizontal: metrics.padding,
    paddingVertical: pill ? space.grid[2] : metrics.padding,
    gap: pill ? space.grid[2] : space.grid[field ? 4 : 3],
    minHeight: size === "hero" ? metrics.heroMinHeight : size === "card" ? metrics.cardMinHeight
      : field ? native.ergonomics.field.primaryActionMinHeight : metrics.pillMinHeight,
    justifyContent: "center" as const,
  }];

  const contents = pill ? (
    <View {...decorative} style={[styles.row, { gap: space.grid[2] }]}>
      <Glyph mark={marks[state]} color={accent} size={20} />
      <Text style={[type.label, polarity.text, styles.fill]}>{stateLabel}</Text>
      {time && <DirectedText dir="ltr" style={[type.supporting, native.tabularNumbers, polarity.text, styles.trailing]}>{time}</DirectedText>}
      {onPress && <Glyph mark="›" color={polarity.text.color} size={20} />}
    </View>
  ) : (
    <View {...decorative} style={{ gap: space.grid[field ? 4 : 3] }}>
      <View style={[styles.row, { gap: space.grid[2] }]}>
        <View style={[styles.row, styles.fill, { gap: space.grid[2] }]}>
          <Glyph mark={marks[state]} color={accent} size={20} />
          <Text style={[type.supporting, polarity.text, styles.fill]}>{source}</Text>
        </View>
        {reference && <Text style={[type.caption, polarity.supportingText, styles.trailing]}>{reference}</Text>}
      </View>
      <View style={{ gap: space.grid[1] }}>
        <View style={[styles.row, { gap: space.grid[2] }]}>
          <Text style={[time ? type.label : size === "hero" ? type.display : type.sectionTitle, { color: time ? accent : polarity.text.color }, styles.fill]}>{stateLabel}</Text>
          {estimate && activity === "live" && (
            <Text style={[type.supporting, native.tabularNumbers, styles.estimate, {
              backgroundColor: field ? color.onLive : color.nightLine,
              color: field ? color.live : color.onNight,
              borderRadius: native.radii.pill,
            }]}>{estimate}</Text>
          )}
        </View>
        {time && <DirectedText dir="ltr" style={[size === "hero" ? type.display : type.sectionTitle, native.tabularNumbers, polarity.text, styles.leading]}>{time}</DirectedText>}
        {zoneLine && <Text style={[type.supporting, native.tabularNumbers, polarity.supportingText]}>{zoneLine}</Text>}
      </View>
      {line && <JobLine {...line} pulse={pulse} surface={lineSurface} activity={activity} />}
      <View style={crew ? [styles.footer, { borderColor: field ? color.livePressed : color.nightLine, gap: space.grid[2] }] : undefined}>
        {crew && <CrewDots {...crew} surface={lineSurface} />}
        <Text style={[type.supporting, native.tabularNumbers, polarity.supportingText]}>{provenance}</Text>
      </View>
    </View>
  );

  const liveRegion = { accessibilityLiveRegion: "polite", "aria-live": "polite" } as const;
  if (!onPress) {
    return <View accessible role="group" accessibilityLabel={accessibilityLabel} {...liveRegion} style={baseStyle}>{contents}</View>;
  }
  return (
    <Pressable
      accessible accessibilityRole="button" accessibilityLabel={accessibilityLabel} {...liveRegion}
      onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed }) => [baseStyle,
        pressed && { backgroundColor: field ? color.livePressed : color.nightLine },
        focused && { outlineColor: polarity.focusRing, outlineStyle: "solid", outlineWidth: native.focus.ringWidth, outlineOffset: native.focus.ringGap },
      ]}
    >
      {contents}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  fill: { flexGrow: 1, flexShrink: 1 },
  leading: { alignSelf: "flex-start", maxWidth: "100%" },
  trailing: { flexShrink: 1, maxWidth: "100%" },
  estimate: { flexShrink: 1, paddingHorizontal: native.spacing.grid[2], paddingVertical: native.spacing.grid[1] },
  footer: { borderTopWidth: 1, paddingTop: native.spacing.grid[2] },
});
