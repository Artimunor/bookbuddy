import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";

export const decorative = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
  "aria-hidden": true,
} as const;

export const motionNativeDriver = Platform.OS !== "web";

// Start static until the preference is known, including while off-screen or rendering on the web server.
export function useReducedMotion(enabled: boolean) {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let observedChange = false;
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      observedChange = true;
      setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active && !observedChange) setReduced(value);
    }, () => {});
    return () => {
      active = false;
      subscription?.remove();
    };
  }, [enabled]);
  return !enabled || reduced;
}

export function Glyph({ mark, color, size = 16 }: { mark: string; color: string; size?: number }) {
  return (
    <View {...decorative} pointerEvents="none" style={[styles.glyph, { width: size, height: size }]}>
      <Text allowFontScaling={false} style={{ color, fontSize: size * 0.76, lineHeight: size, fontWeight: "700" }}>{mark}</Text>
    </View>
  );
}

export type TextDirection = "ltr" | "rtl";

export function DirectedText({ children, dir, lang, style }: {
  children: string;
  dir?: TextDirection;
  lang?: string;
  style?: StyleProp<TextStyle>;
}) {
  const web = Platform.OS === "web" ? { dir, lang } : undefined;
  return (
    <Text {...web} accessibilityLanguage={lang} style={[style, dir && { writingDirection: dir, textAlign: dir === "rtl" ? "right" : "left" }]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  glyph: { alignItems: "center", justifyContent: "center" },
});
