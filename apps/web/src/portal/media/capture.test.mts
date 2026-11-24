import { expect, test } from "bun:test";
import { captureVoice } from "./capture";

test("permission granted after cancellation stops all tracks without starting a recording", async () => {
  const controller = new AbortController();
  let deliver!: (stream: MediaStream) => void;
  const permission = new Promise<MediaStream>(resolve => { deliver = resolve; });
  let stopped = 0;
  let recording = false;
  const capture = captureVoice(controller.signal, () => { recording = true; }, () => permission);
  controller.abort();
  deliver({ getTracks: () => [{ stop: () => stopped++ }, { stop: () => stopped++ }] } as MediaStream);
  await expect(capture).rejects.toHaveProperty("name", "AbortError");
  expect(stopped).toBe(2);
  expect(recording).toBe(false);
});
