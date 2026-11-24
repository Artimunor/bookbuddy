import { expect, test } from "bun:test";
import { preparePhoto } from "./upload";

test("photos re-encode as JPEG with a 2048 pixel long edge without upscaling", async () => {
  const original = Object.getOwnPropertyDescriptors(globalThis);
  let width = 3000, height = 4500, closed = 0;
  const drawn: [number, number][] = [];
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({ drawImage: (_: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]) }),
    toBlob: (finish: (blob: Blob) => void, mime: string) => finish(new Blob(["encoded"], { type: mime })),
  };
  Object.defineProperties(globalThis, {
    createImageBitmap: { configurable: true, value: async () => ({ width, height, close: () => closed++ }) },
    document: { configurable: true, value: { createElement: () => canvas } },
  });
  try {
    expect((await preparePhoto(new File(["source"], "source.png"))).file).toMatchObject({ mime: "image/jpeg" });
    width = 320; height = 240;
    await preparePhoto(new File(["source"], "smaller.png"));
    expect(drawn).toEqual([[1365, 2048], [320, 240]]);
    expect(closed).toBe(2);
  } finally {
    for (const key of ["createImageBitmap", "document"] as const) {
      const descriptor = original[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
