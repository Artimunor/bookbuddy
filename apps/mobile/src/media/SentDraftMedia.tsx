import type { MediaFile } from "@bookbuddy/api-contract";
import { SymbolView } from "expo-symbols";
import { View } from "react-native";
import { useT } from "../i18n";
import { Copy } from "../ui/controls/shared";
import { useBeaconTheme } from "../ui/theme";

export function SentDraftMedia({ kind }: { kind: MediaFile["kind"] }) {
  const t = useT();
  const { color, radius, space } = useBeaconTheme();
  const photo = kind === "photo";
  return <View style={{ flexDirection: "row", alignItems: "center", gap: space.grid[3], padding: space.grid[3],
    borderRadius: radius.card, borderWidth: 1, borderColor: color.separator, backgroundColor: color.surface }}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={{
      width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.card, backgroundColor: color.subtle,
    }}>
      <SymbolView size={20} tintColor={color.muted} name={photo
        ? { ios: "photo", android: "image", web: "image" }
        : { ios: "waveform", android: "mic", web: "mic" }} />
    </View>
    <View style={{ flex: 1, minWidth: 0, gap: space.grid[1] }}>
      <Copy variant="label">{photo ? t("mobile.media.photo") : t("mobile.media.voiceNote")} · {t("mobile.media.sent")}</Copy>
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.sentDraftDescription")}</Copy>
    </View>
  </View>;
}
