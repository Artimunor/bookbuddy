import { expect, test } from "bun:test";
import { colors } from "../src/beacon";
import { contrastFailures, contrastRatio } from "./contrast";

test("computes WCAG contrast for opposite and identical colors", () => {
  expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
  expect(contrastRatio("#FFFFFF", "#000000")).toBe(21);
  expect(contrastRatio("#15171C", "#15171C")).toBe(1);
});

test("both schemes meet the published Beacon contrast, including Field polarity", () => {
  expect(contrastFailures()).toEqual([]);
});

test("rejects unsafe Field text and regressions that are still AA", () => {
  const failures = contrastFailures({
    light: { ...colors.light, muted: "#646970" },
    dark: { ...colors.dark, onLive: colors.dark.ink },
  });
  expect(contrastRatio("#646970", colors.light.canvas)).toBeGreaterThan(4.5);
  expect(failures.some((failure) => failure.startsWith("light muted on canvas"))).toBe(true);
  expect(failures.some((failure) => failure.startsWith("dark Field capsule text"))).toBe(true);
});
