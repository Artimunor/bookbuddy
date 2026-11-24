import { native } from "@bookbuddy/design-tokens";
import type { ComponentRef, ReactNode, Ref } from "react";
import { ActivityIndicator, I18nManager, StyleSheet, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Copy, Target, controlMetrics } from "./shared";

export type ControlAction = {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
};

export type ButtonVariant = "primary" | "live" | "neutral" | "destructive" | "quiet" | "navigation";
export type ButtonProps = ControlAction & {
  variant?: ButtonVariant;
  glyph?: string;
  arrow?: "back" | "next";
  iconOnly?: boolean;
  ref?: Ref<ComponentRef<typeof View>>;
};

export function Button({
  label, accessibilityLabel, onPress, disabled, disabledReason, busy,
  variant = "primary", glyph, arrow, iconOnly = false, ref,
}: ButtonProps) {
  const { color, field, radius, space } = useBeaconTheme();
  const metrics = controlMetrics(field);
  const inactive = disabled || !!disabledReason;
  const quiet = variant === "quiet";
  const borderless = quiet || variant === "navigation";
  const live = variant === "live";
  const primary = variant === "primary";
  const ink = inactive ? color.muted
    : live ? color.onLive
    : primary ? color.onBrand
    : variant === "destructive" ? color.criticalInk
    : quiet ? color.brandInk : color.ink;
  const boundary = borderless ? "transparent" : inactive ? color.outline
    : live ? color.onLive : primary ? color.brand : color.outline;
  const arrowGlyph = arrow && ((arrow === "back") !== (I18nManager.isRTL === true) ? "‹" : "›");
  const icon = glyph ?? arrowGlyph;
  const leading = !!icon && arrow !== "next";

  return (
    <View style={{ gap: space.grid[2] }}>
      <Target
        ref={ref}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={disabledReason}
        accessibilityState={{ disabled: !!inactive || !!busy, busy: !!busy }}
        aria-busy={busy}
        disabled={!!inactive || !!busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            minHeight: metrics.primaryActionMinHeight,
            minWidth: metrics.primaryActionMinHeight,
            borderRadius: radius.pill,
            borderWidth: live ? native.componentMetrics.dock.liveBorderWidth : metrics.controlBorderWidth,
            borderColor: boundary,
            paddingHorizontal: space.grid[4],
            paddingVertical: space.grid[2],
            gap: space.grid[2],
            backgroundColor: inactive ? color.subtle
              : live ? (pressed ? color.livePressed : color.live)
              : primary ? (pressed ? color.brandPressed : color.brand)
              : pressed ? (variant === "destructive" ? color.criticalSoft : color.subtle)
              : borderless ? "transparent" : color.surface,
          },
        ]}
      >
        {leading && <Glyph color={ink}>{icon}</Glyph>}
        {(!iconOnly || !icon || busy) && (
          <Copy variant="label" style={{ color: ink, flexShrink: 1, textAlign: "center", textDecorationLine: quiet ? "underline" : "none" }}>
            {label}
          </Copy>
        )}
        {!leading && icon && <Glyph color={ink}>{icon}</Glyph>}
        {busy && <ActivityIndicator color={ink} accessible={false} accessibilityElementsHidden importantForAccessibility="no" />}
      </Target>
      {!!disabledReason && <Copy variant="supporting" style={{ color: color.muted }}>{disabledReason}</Copy>}
    </View>
  );
}

function Glyph({ color, children }: { color: string; children: ReactNode }) {
  return <Copy accessible={false} accessibilityElementsHidden importantForAccessibility="no" variant="label" style={{ color }}>{children}</Copy>;
}

export type DockProps = {
  primary: ControlAction & { live?: boolean };
  secondary?: ControlAction & { glyph?: string; iconOnly?: boolean };
  context?: string;
};

// Use as Screen.dock or Sheet.dock so the footer stays outside the scrolling content.
export function Dock({ primary: { live, ...primary }, secondary, context }: DockProps) {
  const { color, field, space } = useBeaconTheme();
  return (
    <View style={{
      backgroundColor: color.surface,
      borderTopColor: color.separator,
      borderTopWidth: 1,
      paddingHorizontal: native.componentMetrics.dock.inset,
      paddingVertical: space.grid[3],
      gap: controlMetrics(field).controlGap,
    }}>
      {!!context && <Copy variant="supporting" style={{ color: color.muted }}>{context}</Copy>}
      <Button {...primary} variant={live ? "live" : "primary"} />
      {secondary && <Button {...secondary} variant="quiet" />}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", alignSelf: "stretch" },
});
