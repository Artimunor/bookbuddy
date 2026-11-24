import { native } from "@bookbuddy/design-tokens";
import { useState, type ComponentRef, type ReactNode, type Ref } from "react";
import { Platform, Pressable, Text, type PressableProps, type TextProps, type View, type ViewStyle } from "react-native";
import { useBeaconTheme, type BeaconTheme } from "../theme";

export function controlMetrics(field: boolean) {
  return native.ergonomics[field ? "field" : "standard"];
}

export function minTarget(field: boolean) {
  return field ? native.ergonomics.field.rowMinHeight : Platform.OS === "ios" ? native.hitTargets.iosMinSize : native.hitTargets.androidMinSize;
}

export function focusRing(color: string): ViewStyle {
  return {
    outlineColor: color,
    outlineStyle: "solid",
    outlineWidth: native.focus.ringWidth,
    outlineOffset: native.focus.ringGap,
  };
}

export type Tone = "neutral" | "info" | "success" | "attention" | "critical";

export function toneColors(color: BeaconTheme["color"], tone: Tone) {
  switch (tone) {
    case "info": return { fill: color.infoSoft, ink: color.infoInk };
    case "success": return { fill: color.successSoft, ink: color.successInk };
    case "attention": return { fill: color.attentionSoft, ink: color.attentionInk };
    case "critical": return { fill: color.criticalSoft, ink: color.criticalInk };
    case "neutral": return { fill: color.subtle, ink: color.ink };
  }
}

type CopyProps = TextProps & { variant?: keyof BeaconTheme["type"] };

export function Copy({ variant = "body", style, ...props }: CopyProps) {
  const { color, type } = useBeaconTheme();
  return <Text {...props} style={[type[variant], { color: color.ink }, style]} />;
}

type TargetProps = Omit<PressableProps, "children"> & {
  ref?: Ref<ComponentRef<typeof View>>;
  children: ReactNode | ((pressed: boolean) => ReactNode);
};

export function Target({ ref, style, children, onFocus, onBlur, ...props }: TargetProps) {
  const { field, color } = useBeaconTheme();
  const [focused, setFocused] = useState(false);
  const size = minTarget(field);
  return (
    <Pressable
      {...props}
      ref={ref}
      onFocus={(event) => { setFocused(true); onFocus?.(event); }}
      onBlur={(event) => { setFocused(false); onBlur?.(event); }}
      style={(state) => [
        { minWidth: size, minHeight: size },
        typeof style === "function" ? style(state) : style,
        focused && focusRing(color.brandInk),
      ]}
    >
      {typeof children === "function" ? ({ pressed }) => children(pressed) : children}
    </Pressable>
  );
}
