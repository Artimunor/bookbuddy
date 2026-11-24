import { mediaLimits } from "@bookbuddy/api-contract";

const voiceTypes = ["audio/webm", "audio/mp4", "audio/ogg"];
const recordingType = () => voiceTypes.find(type => MediaRecorder.isTypeSupported(type));

export function canRecordVoice() {
  return typeof MediaRecorder !== "undefined" && typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia && !!recordingType();
}

export async function captureVoice(
  signal: AbortSignal,
  onRecording: (stop: () => void) => void,
  open = () => navigator.mediaDevices.getUserMedia({ audio: true }),
): Promise<{ blob: Blob; durationMs: number }> {
  signal.throwIfAborted();
  const stream = await open();
  try {
    signal.throwIfAborted();
    const type = recordingType();
    if (!type) throw new Error("Recording unsupported");
    const recorder = new MediaRecorder(stream, { mimeType: type });
    const chunks: Blob[] = [];
    return await new Promise((resolve, reject) => {
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      function stop() { if (recorder.state === "recording") recorder.stop(); }
      function cleanup() {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      }
      function cancel() { cleanup(); stop(); reject(signal.reason); }
      signal.addEventListener("abort", cancel, { once: true });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { cleanup(); stop(); reject(new Error("Recording failed")); };
      recorder.onstop = () => {
        cleanup();
        resolve({ blob: new Blob(chunks, { type }), durationMs: Math.min(mediaLimits.voiceDurationMs, Date.now() - started) });
      };
      try {
        recorder.start();
        timer = setTimeout(stop, mediaLimits.voiceDurationMs);
        onRecording(stop);
      } catch (error) { cleanup(); stop(); reject(error); }
    });
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
