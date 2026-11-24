import { mediaLimits } from "@bookbuddy/api-contract";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import type { RecordingOptions, RecordingStatus } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { AttachSource, PickResult } from "../../media";
import { releaseMediaCapture } from "../../media/files";

type FinishMode = "review" | "hold" | "discard";
type CaptureVoice = (source: AttachSource) => Promise<PickResult>;
const options: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true, numberOfChannels: 1, bitRate: 64_000,
  web: { mimeType: "audio/webm", bitsPerSecond: 64_000 },
};

function canStartRecording() {
  const state = AppState.currentState;
  return state !== "background" && state !== "inactive";
}

export function useVoiceCapture(save: CaptureVoice, onResult: (result: PickResult, mode: FinishMode) => void) {
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "stopping">("idle");
  const run = useRef<{ startedAt: number | null; save: CaptureVoice } | null>(null);
  const live = useRef(true);
  const callback = useRef(onResult);
  callback.current = onResult;
  const completed = useRef<(status: RecordingStatus) => void>(() => {});
  const recorder = useAudioRecorder(options, (status) => completed.current(status));

  async function finish(mode: FinishMode, completedUri?: string | null) {
    const capture = run.current;
    if (!capture || capture.startedAt === null) return;
    run.current = null;
    setPhase("stopping");
    const elapsed = Date.now() - capture.startedAt;
    let result: PickResult = { status: "unavailable" };
    try {
      // An OS-finished recorder already owns a completed URI; don't stop it again.
      if (completedUri === undefined) await recorder.stop();
      const uri = completedUri ?? recorder.uri;
      if (uri) {
        if (mode === "discard") {
          await releaseMediaCapture(uri);
          result = { status: "cancelled" };
        } else {
          result = await capture.save({ kind: "voice", uri, durationMs: Math.min(elapsed, mediaLimits.voiceDurationMs) });
          if (result.status === "unavailable") await releaseMediaCapture(uri).catch(() => undefined);
        }
      }
    } catch {
      // Avoid exposing the recorder's file URL in native errors.
    } finally {
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      if (live.current) { setPhase("idle"); callback.current(result, mode); }
    }
  }
  completed.current = (status) => {
    if (status.isFinished || status.mediaServicesDidReset || status.hasError) void finish("hold", status.url);
  };
  const finishOnPause = useRef(finish);
  finishOnPause.current = finish;
  useEffect(() => {
    live.current = true;
    const listener = AppState.addEventListener("change", (next) => { if (next !== "active") void finishOnPause.current("hold"); });
    return () => { live.current = false; listener.remove(); };
  }, []);

  async function start() {
    if (phase !== "idle" || run.current) return;
    const capture = { startedAt: null as number | null, save };
    run.current = capture;
    setPhase("starting");
    let result: PickResult = { status: "unavailable" };
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) result = { status: "denied" };
      else if (live.current && canStartRecording()) {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "doNotMix" });
        await recorder.prepareToRecordAsync();
        if (live.current && canStartRecording()) {
          capture.startedAt = Date.now();
          recorder.record({ forDuration: (mediaLimits.voiceDurationMs - 250) / 1000 });
          setPhase("recording");
          return;
        }
        await recorder.stop().catch(() => undefined);
        if (recorder.uri) await releaseMediaCapture(recorder.uri).catch(() => undefined);
        result = { status: "cancelled" };
      }
    } catch {
      // No partial recording was acknowledged.
    }
    run.current = null;
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    if (live.current) { setPhase("idle"); callback.current(result, "hold"); }
  }
  return { phase, recorder, start, finish };
}
