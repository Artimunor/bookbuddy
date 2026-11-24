import { StyleSheet, View } from "react-native";
import { useT } from "../../i18n";
import type { ScreenPreview } from "../../preview/screens/types";
import { Copy } from "../../ui/controls/shared";
import { useBeaconTheme } from "../../ui/theme";
import { previews as chatPreviews } from "../s-10/preview";
import { AttachPanel, RecordingCard, RecordingDock } from "./View";

const ChatBackdrop = chatPreviews.find(({ state }) => state === "translated")?.render;
const samples = [0.11, 0.37, 0.67, 0.44, 0.81, 0.52, 0.26, 0.74, 0.96, 0.45, 0.22, 0.62, 0.86, 0.39, 0.61, 0.17, 0.53, 0.74, 0.93, 0.58,
  0.35, 0.16, 0.48, 0.72, 0.93, 0.53, 0.3, 0.64, 0.84, 0.45, 0.21, 0.58, 0.77, 0.44, 0.24, 0.56, 0.74, 0.32];
const noop = () => {};

function RecordingFixture() {
  const t = useT();
  const { color } = useBeaconTheme();
  return <View style={{ flex: 1, backgroundColor: color.canvas }}>
    {ChatBackdrop && <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden aria-hidden><ChatBackdrop /></View>}
    <AttachPanel title={t("mobile.media.voiceNote")} destination={t("mobile.media.destinationChat")} onClose={noop}
      dock={<RecordingDock onDiscard={noop} onStop={noop} />}>
      <RecordingCard elapsedMs={12_000} samples={samples} />
      <Copy variant="supporting" style={{ color: color.muted }}>{t("mobile.media.recordingNote")}</Copy>
    </AttachPanel>
  </View>;
}

export const previews: ScreenPreview[] = [{ id: "S-14", state: "recording", render: RecordingFixture }];
