import { native } from "@bookbuddy/design-tokens";
import { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { decorative, Glyph } from "./parts";

export type OfferClockProps = {
  /** The caller-formatted absolute reply or confirmation deadline, including the zone. */
  deadline: string;
  surface?: "neutral" | "capsule" | "fieldCapsule";
} & (
  | { state: "running"; remaining: string; fraction: number; statusLabel?: string }
  | { state: "urgent"; remaining: string; fraction: number; statusLabel: string }
  | { state: "expired" | "filled" | "accepted"; statusLabel: string; remaining?: never; fraction?: never }
);

const { size, ringWidth } = native.componentMetrics.offerClock;
const staticMarks = { expired: "×", filled: "✓", accepted: "◷" } as const;
const webClockDirection = Platform.OS === "web" ? { dir: "ltr" } : undefined;

function ClockRing({ diameter, fraction, track, ink }: { diameter: number; fraction: number; track: string; ink: string }) {
  const half = diameter / 2;
  const circle = { width: diameter, height: diameter, borderRadius: half };
  const arc = { ...circle, borderTopColor: ink, borderRightColor: ink };
  // Clip each rotated semicircle to its own half; the clock always drains clockwise from twelve.
  return (
    <View {...decorative} {...webClockDirection} style={[styles.ring, circle, { borderColor: track }]}>
      {fraction > 0 && (
        <View style={[styles.half, { end: -ringWidth, width: half, height: diameter }]}>
          <View style={[styles.arc, arc, { end: 0, transform: [{ rotate: `${-135 + Math.min(180, fraction * 360)}deg` }] }]} />
        </View>
      )}
      {fraction > 0.5 && (
        <View style={[styles.half, { start: -ringWidth, width: half, height: diameter }]}>
          <View style={[styles.arc, arc, { start: 0, transform: [{ rotate: `${45 + (fraction - 0.5) * 360}deg` }] }]} />
        </View>
      )}
    </View>
  );
}

export function OfferClock(props: OfferClockProps) {
  const { scheme, color, type, space, field } = useBeaconTheme();
  const [readoutBounds, setReadoutBounds] = useState(0);
  const { surface = "neutral", state, statusLabel, deadline } = props;
  const onField = surface === "fieldCapsule";
  const onNight = surface === "capsule";
  const ink = onField ? color.onLive : onNight ? color.onNight : color.ink;
  const muted = onField ? color.onLive : onNight ? color.nightMuted : color.muted;
  const running = state === "running" || state === "urgent";
  const activeInk = onField ? native.componentColors[scheme].offerClock.fieldProgress : onNight ? color.live
    : state === "urgent" ? color.attentionInk : color.ink;
  const track = onField ? native.componentColors[scheme].offerClock.fieldTrack : onNight ? color.nightLine : color.subtle;
  const minDiameter = size + (field ? space.grid[2] : 0);
  const diameter = running ? Math.max(minDiameter, readoutBounds + ringWidth * 2 + space.grid[1]) : size - space.grid[4];
  const fraction = running && Number.isFinite(props.fraction) ? Math.max(0, Math.min(1, props.fraction)) : 0;

  return (
    <View style={[styles.row, { gap: space.grid[field ? 4 : 3] }]}>
      {running ? (
        <View style={[styles.readout, { width: diameter, height: diameter }]}>
          <ClockRing diameter={diameter} fraction={fraction} track={track} ink={activeInk} />
          <Text role="timer" accessibilityLiveRegion="none" aria-live="off"
            onLayout={({ nativeEvent: { layout: { width, height } } }) => setReadoutBounds(Math.ceil(Math.hypot(width, height)))}
            style={[type.supporting, native.tabularNumbers, styles.remaining, { color: ink, maxWidth: minDiameter - ringWidth * 2 }]}>
            {props.remaining}
          </Text>
        </View>
      ) : (
        <View {...decorative} style={[styles.readout, {
          width: diameter, height: diameter, borderRadius: diameter / 2,
          backgroundColor: surface !== "neutral" ? track : state === "expired" ? color.criticalSoft : state === "filled" ? color.successSoft : color.infoSoft,
        }]}>
          <Glyph mark={staticMarks[state]} size={26} color={surface !== "neutral" ? ink : state === "expired" ? color.criticalInk : state === "filled" ? color.successInk : color.infoInk} />
        </View>
      )}
      <View style={[styles.copy, { gap: space.grid[1] }]}>
        <Text style={[type.label, native.tabularNumbers, { color: ink }]}>{deadline}</Text>
        {statusLabel && <Text role="status" accessibilityLiveRegion="polite" aria-live="polite" style={[type.supporting, { color: muted }]}>{statusLabel}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  readout: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", top: 0, start: 0, borderWidth: ringWidth, direction: "ltr" },
  half: { position: "absolute", top: -ringWidth, overflow: "hidden" },
  arc: { position: "absolute", top: 0, borderWidth: ringWidth, borderColor: "transparent" },
  remaining: { textAlign: "center", fontWeight: "700" },
  copy: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 0 },
});
