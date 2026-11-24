import { native } from "@bookbuddy/design-tokens";
import { useEffect, useMemo, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useBeaconTheme } from "../theme";
import { decorative, Glyph, motionNativeDriver, useReducedMotion } from "./parts";

export type JobLineStage =
  | { kind: "journey"; steps: readonly [string, string, string, string, string, string]; current: 0 | 1 | 2 | 3 | 4 | 5; estimate?: never }
  | { kind: "cover"; steps: readonly [string, string, string, string]; current: 0 | 1 | 2 | 3; estimate?: never }
  | ({ kind: "visit"; steps: readonly [string, string, string, string, string] } & (
    | { current: 1; estimate?: { fraction: number; label: string } }
    | { current: 0 | 2 | 3 | 4; estimate?: never }
  ));

export type JobLineProps = JobLineStage & {
  /** A whole, localised step announcement, including any exception or estimate. */
  accessibilityLabel: string;
  status?: { state: "delayed" | "cover" | "cancelled"; label: string };
  activity?: "live" | "quiet" | "upcoming" | "finished";
  pulse?: boolean;
  /** Glance surfaces may omit labels when they show the state separately. */
  compact?: boolean;
  /** Keep the estimate in accessibilityLabel when it is already visible alongside the rail. */
  hideEstimateLabel?: boolean;
  surface?: "neutral" | "capsule" | "fieldCapsule";
};

const metrics = native.componentMetrics.jobLine;
const gap = native.spacing.grid[1];
const railOffset = (metrics.currentRingSize - metrics.railThickness) / 2;

export function JobLine({
  steps, current, estimate, accessibilityLabel, status, activity = "live", pulse: animate = true, compact = false, hideEstimateLabel = false, surface = "neutral",
}: JobLineProps) {
  const { scheme, color, type, motion, space } = useBeaconTheme();
  const palette = native.jobLineColors[scheme][surface];
  const surfaceColor = surface === "fieldCapsule" ? color.live : surface === "capsule" ? color.night : color.surface;
  const steady = surface === "fieldCapsule" ? color.onLive : surface === "capsule" ? color.onNight : color.ink;
  const steadyGlyph = surface === "fieldCapsule" ? color.live : surface === "capsule" ? color.night : color.onBrand;
  const live = activity === "live" && !status;
  const reduceMotion = useReducedMotion(live && animate);
  const fraction = estimate && live && Number.isFinite(estimate.fraction) ? Math.max(0, Math.min(1, estimate.fraction)) : 0;
  const target = (current + fraction) / (steps.length - 1);
  const [progress] = useState(() => new Animated.Value(target));
  const [pulse] = useState(() => new Animated.Value(1));
  const interpolation = useMemo(() => progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }), [progress]);
  const [width, setWidth] = useState(0);
  const { fontScale } = useWindowDimensions();
  // At large text sizes, keep the same stage order and let the labels use the whole width.
  const vertical = !compact && (fontScale > 1.25 || (width > 0 && width < steps.length * 46 * fontScale));

  useEffect(() => {
    if (reduceMotion || vertical) {
      progress.setValue(target);
      return;
    }
    const transition = Animated.timing(progress, {
      toValue: target,
      duration: motion.stageChange.springDurationMs,
      easing: Easing.linear,
      useNativeDriver: false, // The rail's logical inline length is a layout property.
      isInteraction: false,
    });
    transition.start();
    return () => transition.stop();
  }, [motion, progress, reduceMotion, target, vertical]);

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, {
      toValue: motion.livePulse.toOpacity,
      duration: motion.livePulse.durationMs,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: motionNativeDriver,
      isInteraction: false,
    }));
    loop.start();
    return () => loop.stop();
  }, [motion, pulse, reduceMotion]);

  const inset = `${50 / steps.length}%` as const;
  const progressColor = live ? palette.progress : steady;
  const renderBead = (i: number) => {
    const isDone = i < current || (i === current && activity === "finished");
    const isCurrent = i === current && !isDone;
    const beadColor = isDone ? (live ? palette.done : steady) : isCurrent && live ? palette.current : surfaceColor;
    const currentRing = activity === "upcoming" && surface === "capsule" ? palette.progress : live ? palette.currentRing : steady;
    const borderColor = isDone ? beadColor : isCurrent ? currentRing : palette.nextRing;
    return (
      <View style={styles.socket}>
        {isCurrent && live && <Animated.View style={[styles.ring, { opacity: pulse, borderColor }]} />}
        <View style={[styles.bead, { backgroundColor: beadColor, borderColor }]}>
          {isDone && <Glyph mark="✓" color={live ? palette.doneGlyph : steadyGlyph} size={metrics.beadSize - 4} />}
          {isCurrent && live && <View style={[styles.dot, { backgroundColor: surface === "fieldCapsule" ? color.live : color.onLive }]} />}
          {isCurrent && status?.state === "cancelled" && <Glyph mark="×" color={steady} size={metrics.beadSize - 4} />}
        </View>
      </View>
    );
  };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <View {...decorative} onLayout={compact ? undefined : ({ nativeEvent }) => setWidth(nativeEvent.layout.width)} style={{ gap: space.grid[2] }}>
        {vertical ? (
          <View>
            {steps.map((step, i) => (
              <View key={i} style={[styles.verticalStep, { columnGap: space.grid[2] }]}>
                {i < steps.length - 1 && (
                  <View style={[styles.verticalRail, { backgroundColor: palette.rail }]}>
                    {(i < current || (i === current && fraction > 0)) && (
                      <View style={[styles.verticalFill, { backgroundColor: progressColor, height: i < current ? "100%" : `${fraction * 100}%` }]} />
                    )}
                  </View>
                )}
                {renderBead(i)}
                <Text style={[i === current ? type.supporting : type.caption, styles.verticalLabel, { color: palette.label }]}>{step}</Text>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.row}>
            <View style={[styles.rail, { start: inset, end: inset, backgroundColor: palette.rail }]}>
              <Animated.View style={[styles.fill, { width: interpolation, backgroundColor: progressColor }]} />
            </View>
            {steps.map((step, i) => (
              <View key={i} style={styles.step}>
                {renderBead(i)}
                {!compact && i >= current && (
                  <Text style={[type.caption, styles.stepLabel, { color: palette.label },
                    i === steps.length - 1 && styles.lastLabel, i === current && styles.currentLabel]}>{step}</Text>
                )}
              </View>
            ))}
          </View>
        )}
        {live && estimate && !hideEstimateLabel && <Text style={[type.caption, { color: palette.label }]}>{estimate.label}</Text>}
        {status && <Text style={[type.supporting, { color: palette.label }]}>{status.label}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  rail: { position: "absolute", top: railOffset, height: metrics.railThickness, borderRadius: metrics.railRadius, overflow: "hidden" },
  fill: { position: "absolute", start: 0, height: "100%", borderRadius: metrics.railRadius },
  step: { flex: 1, minWidth: 0, alignItems: "center", gap },
  stepLabel: { textAlign: "center", maxWidth: "100%" },
  currentLabel: { fontWeight: "800" },
  lastLabel: { alignSelf: "flex-end", textAlign: "auto" },
  socket: { width: metrics.currentRingSize, height: metrics.currentRingSize, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", top: 0, bottom: 0, start: 0, end: 0, borderRadius: metrics.currentRingSize / 2, borderWidth: 2 },
  bead: {
    width: metrics.beadSize, height: metrics.beadSize, borderRadius: metrics.beadSize / 2,
    borderWidth: metrics.limeBorderWidth, alignItems: "center", justifyContent: "center",
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  verticalStep: { flexDirection: "row", alignItems: "flex-start", minHeight: metrics.currentRingSize + gap },
  verticalRail: { position: "absolute", start: railOffset, top: metrics.currentRingSize / 2, bottom: -metrics.currentRingSize / 2, width: metrics.railThickness },
  verticalFill: { width: "100%" },
  verticalLabel: { flex: 1, paddingVertical: gap },
});
