import { useRef, useState } from "react";
import type { ComponentRef } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import type { GestureResponderEvent } from "react-native";
import { useT } from "../../i18n";
import { Button } from "../../ui/controls";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

const nativeZoom = Platform.OS === "ios";
const maxZoom = 4;

export function PhotoPreview({ uri, description, onError }: { uri: string; description: string; onError: () => void }) {
  const t = useT();
  const { color, space, radius } = useBeaconTheme();
  const { height } = useWindowDimensions();
  const frameHeight = Math.min(360, Math.max(220, height * 0.39));
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const lastTap = useRef(0);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);

  function zoom(level: number) {
    const next = Math.min(maxZoom, Math.max(1, level));
    if (nativeZoom && width > 0) {
      const w = width / next;
      const h = frameHeight / next;
      scroll.current?.scrollResponderZoomTo({ x: (width - w) / 2, y: (frameHeight - h) / 2, width: w, height: h, animated: true });
    }
    setScale(next);
  }
  function tap() {
    const now = Date.now();
    if (now - lastTap.current < 300) { lastTap.current = 0; zoom(scale > 1.01 ? 1 : 2); }
    else lastTap.current = now;
  }
  function movePinch(event: GestureResponderEvent) {
    const [left, right] = event.nativeEvent.touches;
    if (!left || !right) { pinch.current = null; return; }
    const distance = Math.hypot(left.pageX - right.pageX, left.pageY - right.pageY);
    if (!distance) return;
    if (!pinch.current) pinch.current = { distance, scale };
    else zoom(pinch.current.scale * distance / pinch.current.distance);
  }

  const image = <Pressable accessible={false} focusable={false} onPress={tap} style={{ height: frameHeight, width: width || "100%" }}>
    <Image source={{ uri, cache: "reload" }} accessible accessibilityRole="image" accessibilityLabel={description}
      onError={onError} resizeMode="contain" style={[styles.image, !nativeZoom && { transform: [{ scale }] }]} />
  </Pressable>;
  return <View style={{ gap: space.grid[3] }}>
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{ height: frameHeight, borderRadius: radius.card, backgroundColor: color.subtle, overflow: "hidden" }}>
      {nativeZoom ? <ScrollView ref={scroll} minimumZoomScale={1} maximumZoomScale={maxZoom} centerContent
        bouncesZoom={false} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}
        onScroll={(event) => { const zoomScale = event.nativeEvent.zoomScale; if (zoomScale) setScale(zoomScale); }} scrollEventThrottle={64}>
        {image}
      </ScrollView> : <View onTouchStart={movePinch} onTouchMove={movePinch} onTouchEnd={() => { pinch.current = null; }}
        onTouchCancel={() => { pinch.current = null; }}>{image}</View>}
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.grid[3] }}>
      <Copy variant="supporting" style={{ color: color.muted, flexGrow: 1 }}>{t("mobile.media.zoomHint")}</Copy>
      <Button label={t("mobile.media.zoomOut")} glyph="−" iconOnly variant="neutral" disabled={scale <= 1.01} onPress={() => zoom(scale / 1.5)} />
      <Button label={t("mobile.media.zoomIn")} glyph="+" iconOnly variant="neutral" disabled={scale >= maxZoom - 0.01} onPress={() => zoom(scale * 1.5)} />
    </View>
  </View>;
}

const styles = StyleSheet.create({ image: { width: "100%", height: "100%" } });
