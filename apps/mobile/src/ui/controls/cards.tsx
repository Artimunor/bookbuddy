import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Button, type ControlAction } from "./actions";
import { Copy, Target, controlMetrics, toneColors, type Tone } from "./shared";

export type CardProps = { children: ReactNode; dense?: boolean } & (
  | { onPress?: undefined; accessibilityLabel?: never }
  | { onPress: () => void; accessibilityLabel: string }
);

export function Card({ children, onPress, accessibilityLabel, dense = false }: CardProps) {
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  const style = {
    backgroundColor: color.surface,
    borderColor: onPress && !dense ? color.outline : color.separator,
    borderWidth: onPress && !dense ? metrics.controlBorderWidth : 1,
    borderRadius: radius.card,
    padding: dense ? space.grid[4] : space.cardPadding,
    gap: dense ? space.grid[field ? 3 : 2] : metrics.controlGap,
  };
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Target
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { backgroundColor: color.subtle }]}
    >
      {children}
    </Target>
  );
}

export type BadgeProps = { label: string; tone?: Tone; glyph?: string };

const toneGlyphs = { neutral: "•", info: "ⓘ", success: "✓", attention: "!", critical: "×" } as const;

export function Badge({ label, tone = "neutral", glyph = toneGlyphs[tone] }: BadgeProps) {
  const { color, radius, space } = useBeaconTheme();
  const { fill, ink } = toneColors(color, tone);
  return (
    <View accessible accessibilityLabel={label} style={[styles.badge, {
      backgroundColor: fill, borderRadius: radius.pill, gap: space.grid[1],
      paddingHorizontal: space.grid[2], paddingVertical: space.grid[1],
    }]}>
      <Copy aria-hidden variant="caption" style={{ color: ink }}>{glyph}</Copy>
      <Copy variant="caption" style={{ color: ink, flexShrink: 1 }}>{label}</Copy>
    </View>
  );
}

export type BookingCardProps = {
  title: string;
  place: string;
  stage: string;
  next?: string;
  tone?: Tone;
  /** Noninteractive mini job line, if there is a confirmed journey to display. */
  progress?: ReactNode;
  accessibilityLabel: string;
  onPress: () => void;
};

export function BookingCard({ title, place, stage, next, tone, progress, onPress, accessibilityLabel }: BookingCardProps) {
  const { color, space } = useBeaconTheme();
  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel}>
      <View style={{ gap: space.grid[1] }}>
        <Copy variant="sectionTitle">{title}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>{place}</Copy>
      </View>
      <Badge label={stage} tone={tone} />
      {progress && <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{progress}</View>}
      {!!next && <Copy variant="label">{next}</Copy>}
    </Card>
  );
}

export type NeedsYouCardProps = {
  label: string;
  title: string;
  description?: string;
  action: ControlAction;
};

export function NeedsYouCard({ label, title, description, action }: NeedsYouCardProps) {
  const { color, radius, space, field } = useBeaconTheme();
  return (
    <View style={{
      backgroundColor: color.attentionSoft,
      borderColor: color.attentionInk,
      borderWidth: controlMetrics(field).controlBorderWidth,
      borderRadius: radius.card,
      padding: space.cardPadding,
      gap: controlMetrics(field).controlGap,
    }}>
      <Copy variant="label" style={{ color: color.attentionInk }}>{label}</Copy>
      <Copy variant="sectionTitle" style={{ color: color.attentionInk }}>{title}</Copy>
      {!!description && <Copy style={{ color: color.attentionInk }}>{description}</Copy>}
      <Button {...action} />
    </View>
  );
}

type TwinOriginal = { text: string; direction?: "ltr" | "rtl" };

type TwinContent =
  | { state: "original"; original: TwinOriginal & { label: string } }
  | { state: "translated"; translation: { text: string; label: string; direction?: "ltr" | "rtl" }; original: TwinOriginal & { label: string } }
  | { state: "pending" | "unavailable"; original: TwinOriginal & { label: string }; status: string };

export type TwinCardProps = TwinContent & { title?: string };

export function TwinCard(props: TwinCardProps) {
  const { color, radius, field, space } = useBeaconTheme();
  const { original, title } = props;
  const translated = props.state === "translated";
  const status = props.state === "pending" || props.state === "unavailable" ? props.status : undefined;
  const hasStrip = translated || !!status;
  const padding = { padding: space.cardPadding, gap: space.grid[2] };
  function block({ label, text, direction }: TwinOriginal & { label: string }) {
    return (
      <>
        <Copy variant="caption" style={{ color: color.muted }}>{label}</Copy>
        <Copy style={direction && { writingDirection: direction, textAlign: direction === "rtl" ? "right" : "left" }}>{text}</Copy>
      </>
    );
  }
  return (
    <View style={{
      backgroundColor: color.surface,
      borderColor: color.separator,
      borderWidth: 1,
      borderRadius: radius.card,
      overflow: "hidden",
    }}>
      <View style={[padding, !!title && { gap: controlMetrics(field).controlGap }]}>
        {!!title && <Copy variant="sectionTitle">{title}</Copy>}
        {block(translated ? props.translation : original)}
      </View>
      {hasStrip && (
        <View style={[padding, { backgroundColor: color.subtle }]}>
          {translated ? block(original) : <Copy variant="supporting" accessibilityLiveRegion="polite" style={{ color: color.muted }}>{status}</Copy>}
        </View>
      )}
    </View>
  );
}

export type BannerState = "offline" | "last-confirmed" | "saved-on-device" | "not-sent";
export type StatusBannerProps = {
  state: BannerState;
  label: string;
  detail?: string;
  action?: ControlAction;
};

const bannerTones = {
  offline: "attention",
  "last-confirmed": "info",
  "saved-on-device": "attention",
  "not-sent": "critical",
} as const;

export function StatusBanner({ state, label, detail, action }: StatusBannerProps) {
  const { color, radius, field, space } = useBeaconTheme();
  const tone = bannerTones[state];
  const { fill, ink } = toneColors(color, tone);
  return (
    <View style={{
      padding: space.grid[4], gap: controlMetrics(field).controlGap, borderRadius: radius.input, backgroundColor: fill,
    }}>
      <View accessibilityLiveRegion="polite" style={[styles.bannerText, { gap: space.grid[2] }]}>
        <Copy variant="label" aria-hidden style={{ color: ink }}>{toneGlyphs[tone]}</Copy>
        <View style={styles.textColumn}>
          <Copy variant="label" style={{ color: ink }}>{label}</Copy>
          {!!detail && <Copy variant="supporting" style={{ color: ink }}>{detail}</Copy>}
        </View>
      </View>
      {action && <Button {...action} variant="neutral" />}
    </View>
  );
}

export type EmptyStateProps = {
  title: string;
  description: string;
  glyph?: string;
  action?: ControlAction;
};

export function EmptyState({ title, description, glyph, action }: EmptyStateProps) {
  const { color, space } = useBeaconTheme();
  return (
    <Card>
      {!!glyph && <Copy variant="sectionTitle" aria-hidden>{glyph}</Copy>}
      <View style={{ gap: space.grid[1] }}>
        <Copy variant="sectionTitle" accessibilityRole="header">{title}</Copy>
        <Copy style={{ color: color.muted }}>{description}</Copy>
      </View>
      {action && <Button {...action} variant="neutral" />}
    </Card>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "flex-start", maxWidth: "100%" },
  bannerText: { flexDirection: "row", alignItems: "flex-start" },
  textColumn: { flex: 1, minWidth: 0 },
});
