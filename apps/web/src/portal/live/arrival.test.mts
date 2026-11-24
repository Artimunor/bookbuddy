import { expect, mock, spyOn, test } from "bun:test";
import { subscribeArrivalExpiry } from "./arrival";

test.each(["timer", "foreground"])("arrival expiry recomputes exactly once at the deadline via %s", (trigger) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "document");
  const page = Object.assign(new EventTarget(), { visibilityState: "hidden" });
  Object.defineProperty(globalThis, "document", { configurable: true, value: page });
  const now = spyOn(Date, "now").mockReturnValue(1_000);
  let fire: (() => void) | undefined;
  const schedule = spyOn(globalThis, "setTimeout").mockImplementation((handler) => {
    if (typeof handler === "function") fire = handler;
    return 1 as unknown as ReturnType<typeof setTimeout>;
  });
  const clear = spyOn(globalThis, "clearTimeout").mockImplementation(() => { fire = undefined; });
  const expired = mock(() => {});
  const unsubscribe = subscribeArrivalExpiry(1_040, expired);
  try {
    expect(schedule).toHaveBeenCalledWith(expect.any(Function), 40);
    expect(expired).not.toHaveBeenCalled();
    now.mockReturnValue(1_040);
    if (trigger === "timer") fire?.();
    else {
      page.dispatchEvent(new Event("visibilitychange"));
      expect(expired).not.toHaveBeenCalled();
      page.visibilityState = "visible";
      page.dispatchEvent(new Event("visibilitychange"));
    }
    expect(expired).toHaveBeenCalledTimes(1);
    expect(fire).toBeUndefined();
    page.dispatchEvent(new Event("visibilitychange"));
    expect(expired).toHaveBeenCalledTimes(1);
  } finally {
    unsubscribe();
    clear.mockRestore();
    schedule.mockRestore();
    now.mockRestore();
    if (before) Object.defineProperty(globalThis, "document", before);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
