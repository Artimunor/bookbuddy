import { native } from "@bookbuddy/design-tokens";
import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { useBeaconTheme } from "../theme";
import { Copy, Target } from "./shared";

export type ThumbProps = {
  uri?: string;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
};

export function Thumb({ uri, label, onPress, disabled }: ThumbProps) {
  const { color, radius } = useBeaconTheme();
  const [failedUri, setFailedUri] = useState<string>();
  const ready = !!uri && failedUri !== uri;
  const tile = [styles.tile, { borderRadius: radius.smallTile, backgroundColor: color.subtle, borderColor: color.separator }];
  const contents = ready ? <Image source={{ uri }} resizeMode="cover" style={styles.image} onError={() => setFailedUri(uri)} />
    : <Copy variant="sectionTitle" accessible={false} style={{ color: color.muted }}>▧</Copy>;
  if (!onPress) return <View accessible accessibilityRole="image" accessibilityLabel={label} style={tile}>{contents}</View>;
  return <Target accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [tile, pressed && { borderColor: color.outline }]}>{contents}</Target>;
}

const size = native.componentMetrics.stamp.photoThumbnailSize;
const styles = StyleSheet.create({
  tile: { width: size, height: size, overflow: "hidden", alignItems: "center", justifyContent: "center", borderWidth: 1 },
  image: { width: "100%", height: "100%" },
});
