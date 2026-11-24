import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useT } from "../../i18n";
import { mediaClock } from "../../media/time";
import { Button } from "../../ui/controls";
import { Copy, Target } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";

export function VoicePreview({ uri, durationMs, language, onError }: {
  uri: string; durationMs: number; language?: string; onError: () => void;
}) {
  const t = useT();
  const { color, radius, space } = useBeaconTheme();
  const player = useAudioPlayer(uri, { downloadFirst: false, updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const [width, setWidth] = useState(0);
  const live = useRef(false);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (status.error) onError(); }, [status.error, onError]);
  const duration = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : durationMs / 1000;
  const time = Number.isFinite(status.currentTime) ? Math.max(0, Math.min(duration, status.currentTime)) : 0;
  const label = t("mobile.media.playbackTime", { current: mediaClock(time), duration: mediaClock(duration) });

  function seek(at: number) {
    if (status.isLoaded) void player.seekTo(Math.min(duration, Math.max(0, at))).catch(onError);
  }
  async function toggle() {
    try {
      if (status.playing) { player.pause(); return; }
      await setAudioModeAsync({ playsInSilentMode: true });
      if (!live.current) return;
      if (status.didJustFinish || time >= duration) await player.seekTo(0);
      if (live.current) player.play();
    } catch { if (live.current) onError(); }
  }

  return <View style={{ borderWidth: 1, borderColor: color.separator, borderRadius: radius.card, padding: space.grid[4], gap: space.grid[4], backgroundColor: color.surface }}>
    <View style={{ alignSelf: "flex-start", borderRadius: radius.pill, backgroundColor: color.subtle, paddingHorizontal: space.grid[3], paddingVertical: space.grid[1] }}>
      <Copy variant="caption">{language ? t("mobile.media.originalLanguage", { language }) : t("mobile.media.original")}</Copy>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.grid[4], flexWrap: "wrap" }}>
      <Button label={status.playing ? t("mobile.media.pause") : t("mobile.media.play")} glyph={status.playing ? "Ⅱ" : "▶"}
        iconOnly disabled={!status.isLoaded} onPress={() => { void toggle(); }} />
      <View style={{ flexShrink: 1 }}>
        <Copy variant="sectionTitle" style={{ fontVariant: ["tabular-nums"], writingDirection: "ltr" }}>{label}</Copy>
        <Copy variant="supporting" style={{ color: color.muted }}>
          {!status.isLoaded || status.isBuffering ? t("mobile.media.loading") : status.playing ? t("mobile.media.playing") : t("mobile.media.paused")}
        </Copy>
      </View>
    </View>
    <Target accessibilityRole="adjustable" accessibilityLabel={t("mobile.media.seek")}
      accessibilityValue={{ min: 0, max: Math.ceil(duration), now: Math.floor(time), text: label }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      accessibilityState={{ disabled: !status.isLoaded }} disabled={!status.isLoaded}
      onAccessibilityAction={({ nativeEvent }) => { seek(time + (nativeEvent.actionName === "increment" ? 5 : -5)); }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onPress={(event) => { if (width > 0) seek(event.nativeEvent.locationX / width * duration); }}
      style={{ justifyContent: "center", direction: "ltr" }}>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={{ backgroundColor: color.outline, height: 4, borderRadius: 2, overflow: "hidden" }}>
        <View style={{ backgroundColor: color.ink, width: `${duration > 0 ? time / duration * 100 : 0}%`, height: 4 }} />
      </View>
    </Target>
  </View>;
}
