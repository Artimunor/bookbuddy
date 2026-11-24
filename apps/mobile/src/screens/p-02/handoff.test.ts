import { expect, test } from "bun:test";
import { handoffPresentation } from "./handoff";

const preview = {
  revision: 0,
  handoffPreview: { deadlines: { standard: null, urgent: 1_800_000 } },
  handoff: null,
};
const receipt = { jobId: "job", handoffId: "urgent", revision: 1, state: "offered" as const, expiresAt: 2_400_000, endedAt: null };

test("a preview with only an urgent deadline enables only Urgent", () => {
  expect(handoffPresentation(preview, null, "job", null)).toEqual({
    awaitingDetail: false, discardReceipt: false, standard: false, urgent: true, replyAt: null,
  });
});

test("the issued receipt, not the preview, determines the confirmed reply deadline", () => {
  for (const detail of [preview, null]) {
    expect(handoffPresentation(detail, receipt, "job", null)).toEqual({
      awaitingDetail: true, discardReceipt: false, standard: false, urgent: false, replyAt: receipt.expiresAt,
    });
  }
  const refreshed = { revision: 1, handoffPreview: null, handoff: { handoffId: "urgent", expiresAt: 1_800_000 } };
  expect(handoffPresentation(refreshed, receipt, "job", null).replyAt).toBe(receipt.expiresAt);
  const newer = { ...refreshed, revision: 2, handoff: { handoffId: "newer", expiresAt: 3_000_000 } };
  expect(handoffPresentation(newer, receipt, "job", null).replyAt).toBe(newer.handoff.expiresAt);
  expect(handoffPresentation(null, receipt, "other", null).replyAt).toBeNull();
});

test("a detail refresh keeps the confirmed receipt on transient errors but discards it on access denial", () => {
  for (const error of [{ code: "NETWORK_ERROR", delivery: "unknown" }, { code: "UNAVAILABLE" }] as const) {
    expect(handoffPresentation(null, receipt, "job", error)).toMatchObject({
      awaitingDetail: true, discardReceipt: false, replyAt: receipt.expiresAt,
    });
  }
  for (const error of [
    { code: "NOT_FOUND" },
    { code: "INVALID_RESPONSE", delivery: "unknown", status: 403 },
    { code: "INVALID_RESPONSE", delivery: "unknown", status: 404 },
  ] as const) {
    expect(handoffPresentation(null, receipt, "job", error)).toMatchObject({
      awaitingDetail: false, discardReceipt: true, replyAt: null,
    });
  }
  expect(handoffPresentation(null, receipt, "job", { code: "UNAUTHENTICATED" })).toMatchObject({
    awaitingDetail: false, discardReceipt: false, replyAt: null,
  });
});
